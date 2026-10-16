import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { ResourceGroupsTaggingAPIClient, GetResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";
import { CloudWatchClient, DescribeAlarmsCommand, ListDashboardsCommand } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { CloudTrailClient, DescribeTrailsCommand, GetTrailStatusCommand, GetEventSelectorsCommand, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import { EC2Client, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { S3Client, GetPublicAccessBlockCommand, GetBucketEncryptionCommand, GetBucketVersioningCommand } from "@aws-sdk/client-s3";
import { IAMClient, GetAccountSummaryCommand, GetCredentialReportCommand } from "@aws-sdk/client-iam";
import { credentialObservations } from "./aws-identity.mjs";
import { AccessAnalyzerClient, GetAnalyzerCommand, ListFindingsV2Command } from "@aws-sdk/client-accessanalyzer";

const obs = (id, status, summary, detail = {}) => ({ id, status, summary, ...detail });

/** SDK clients are constructed internally; profiles cannot set custom endpoints
 * or arbitrary API actions. There are no mutating AWS commands in this module.
 */
export async function collectAws(context, profile) {
  const c = profile.config;
  if (!c.accessKeyId || !c.secretAccessKey) throw new Error("AWS connection credentials are not configured.");
  let credentials = { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}) };
  const region = c.regions[0];
  const invoke = async (client, command) => {
    if (context.broker.signal?.aborted) throw new Error("Review cancelled.");
    if (++context.broker.calls > context.broker.maxCalls) throw new Error("Review tool-call budget exhausted.");
    await context.broker.audit(context.broker.owner, "tool.aws.read", context.broker.jobId, { command: command.constructor.name, accountId: c.accountId, region: client.config.region ? await client.config.region() : region });
    return client.send(command, { abortSignal: AbortSignal.any([AbortSignal.timeout(15000), ...(context.broker.signal ? [context.broker.signal] : [])]) });
  };
  if (c.roleArn) {
    if (!c.roleArn.startsWith(`arn:aws:iam::${c.accountId}:role/`)) throw new Error("Role ARN is outside the configured AWS account.");
    const assumed = await invoke(new STSClient({ region, credentials, maxAttempts: 1 }), new AssumeRoleCommand({ RoleArn: c.roleArn, RoleSessionName: `arq-${context.broker.jobId.slice(0, 12)}`, DurationSeconds: 900, ...(c.externalId ? { ExternalId: c.externalId } : {}) }));
    credentials = { accessKeyId: assumed.Credentials.AccessKeyId, secretAccessKey: assumed.Credentials.SecretAccessKey, sessionToken: assumed.Credentials.SessionToken };
  }
  const identity = await invoke(new STSClient({ region, credentials, maxAttempts: 1 }), new GetCallerIdentityCommand({}));
  if (identity.Account !== c.accountId) throw new Error("AWS credential identity does not match the connection account.");
  const save = async (layer, source, observations, detail = {}) => context.save({ layer, source, collectedAt: new Date().toISOString(), observations, ...detail });
  if (c.includeIdentityAudit === true) {
    try {
      const report = await invoke(new IAMClient({ region, credentials, maxAttempts: 1 }), new GetCredentialReportCommand({}));
      const observations = credentialObservations(report, c);
      await save("identity", `aws-iam://${c.accountId}`, observations, { assets: [...new Set(observations.map(item => item.assetId).filter(Boolean))].map(id => ({ id, kind: "identity:user" })), limitation: "Explicit IAM users only. Identity Center, effective policies, trusts and privilege escalation require additional connected evidence." });
    } catch {
      await save("identity", `aws-iam://${c.accountId}`, [obs("aws-iam-console-mfa", "not_assessed", "Existing IAM credential report unavailable. No report generation or permission change was attempted.", { securityPillar: "identity" })]);
    }
  }
  for (const r of c.regions) {
    const config = { region: r, credentials, maxAttempts: 1 };
    const scoped = c.tagKey && c.tagValue ? [{ Key: c.tagKey, Values: [c.tagValue] }] : null;
    if (!scoped) throw new Error("AWS asset discovery requires an explicit application tag key and value.");
    const discovery = await invoke(new ResourceGroupsTaggingAPIClient(config), new GetResourcesCommand({ TagFilters: scoped, ResourcesPerPage: 100 }));
    const assets = (discovery.ResourceTagMappingList ?? []).map(item => ({ id: item.ResourceARN, name: item.ResourceARN.split(":").at(-1), kind: item.ResourceARN.split(":")[2], region: r }));
    await save("cloud", `aws://${c.accountId}/${r}`, [obs("aws-inventory", "pass", `${assets.length} application-tagged AWS assets discovered.`, { truncated: Boolean(discovery.PaginationToken) })], { assets, edges: assets.map(asset => ({ from: `application:${context.target.origin}`, to: asset.id, relation: "application_tag" })) });
    if (c.accessAnalyzerArn?.startsWith(`arn:aws:access-analyzer:${r}:${c.accountId}:analyzer/`)) {
      try {
        const analyzer = new AccessAnalyzerClient(config);
        const metadata = await invoke(analyzer, new GetAnalyzerCommand({ analyzerName: c.accessAnalyzerArn.split("/").at(-1) }));
        const detail = metadata.analyzer, lastAnalyzed = Date.parse(detail?.lastResourceAnalyzedAt);
        if (detail?.status !== "ACTIVE" || !Number.isFinite(lastAnalyzed) || Date.now() - lastAnalyzed > 86400000 || lastAnalyzed > Date.now() + 300000) throw new Error("Analyzer is inactive or has no recent scan metadata.");
        const scope = new Set(assets.map(asset => asset.id));
        const findings = []; let nextToken, pages = 0;
        do {
          const page = await invoke(analyzer, new ListFindingsV2Command({ analyzerArn: c.accessAnalyzerArn, filter: { status: { eq: ["ACTIVE"] } }, maxResults: 100, ...(nextToken ? { nextToken } : {}) }));
          if (!Array.isArray(page.findings)) throw new Error("Analyzer returned an incomplete findings response.");
          findings.push(...page.findings.filter(finding => scope.has(finding.resource)));
          nextToken = page.nextToken; pages++;
        } while (nextToken && pages < 3);
        await save("identity", c.accessAnalyzerArn, [obs("aws-access-analyzer-findings", findings.length ? "fail" : nextToken || !scope.size || discovery.PaginationToken ? "not_assessed" : "pass", `${findings.length} active Access Analyzer findings matched the discovered application assets. This checks unresolved findings in this configured analyzer, not all effective permissions or full analyzer resource coverage.`, { securityPillar: "identity", truncated: Boolean(nextToken), findingIds: findings.map(finding => finding.id), analyzerType: detail.type, lastAnalyzedAt: detail.lastResourceAnalyzedAt })]);
      } catch {
        await save("identity", c.accessAnalyzerArn, [obs("aws-access-analyzer-findings", "not_assessed", "Configured Access Analyzer is unavailable, stale, or could not be completely queried within the read budget.", { securityPillar: "identity" })]);
      }
    }
    const allowedNames = new Set(assets.map(asset => asset.name));
    const cw = new CloudWatchClient(config), logs = new CloudWatchLogsClient(config), trail = new CloudTrailClient(config);
    const [alarms, dashboards, groups, trails] = await Promise.allSettled([
      invoke(cw, new DescribeAlarmsCommand({ MaxRecords: 100 })),
      invoke(cw, new ListDashboardsCommand({ DashboardNamePrefix: c.dashboardPrefix || c.tagValue })),
      invoke(logs, new DescribeLogGroupsCommand({ logGroupNamePrefix: c.logGroupPrefix || `/${c.tagValue}`, limit: 50 })),
      invoke(trail, new DescribeTrailsCommand({ includeShadowTrails: false })),
    ]);
    const observations = [];
    if (alarms.status === "fulfilled") {
      const relevant = (alarms.value.MetricAlarms ?? []).filter(alarm => alarm.AlarmName?.startsWith(c.alarmPrefix || c.tagValue) || alarm.Dimensions?.some(dimension => allowedNames.has(dimension.Value)));
      observations.push(obs("aws-alarm-routing", relevant.length ? relevant.every(alarm => alarm.ActionsEnabled && alarm.AlarmActions?.length) ? "pass" : "fail" : "not_assessed", `${relevant.length} application alarms inspected for enabled notification actions.`, { truncated: Boolean(alarms.value.NextToken) }));
    }
    if (groups.status === "fulfilled") {
      const relevant = groups.value.logGroups ?? [];
      const minimum = Number(c.minimumLogRetentionDays || 90);
      observations.push(obs("aws-log-retention", relevant.length ? relevant.every(group => group.retentionInDays === undefined || group.retentionInDays >= minimum) ? "pass" : "fail" : "not_assessed", `${relevant.length} scoped log groups checked against the configured ${minimum}-day retention requirement.`, { minimumDays: minimum, truncated: Boolean(groups.value.nextToken) }));
    }
    if (dashboards.status === "fulfilled") observations.push(obs("aws-dashboard-inventory", "pass", `${dashboards.value.DashboardEntries?.length ?? 0} dashboards found by the explicit application prefix; dashboard presence is not control effectiveness.`));
    await save("monitoring", `aws-cloudwatch://${c.accountId}/${r}`, observations);
    if (trails.status === "fulfilled") {
      const expected = new Set(c.trailArns ?? []);
      const selected = (trails.value.trailList ?? []).filter(item => expected.has(item.TrailARN));
      if (!expected.size) await save("audit", `aws-cloudtrail://${c.accountId}/${r}`, [obs("aws-trail-recording", "not_assessed", "Specify the CloudTrail ARN(s) covering this application; no account-wide trail was assumed to cover it.")]);
      for (const item of selected.slice(0, 3)) {
        const [status, selectors] = await Promise.all([
          invoke(trail, new GetTrailStatusCommand({ Name: item.TrailARN })), invoke(trail, new GetEventSelectorsCommand({ TrailName: item.TrailARN })),
        ]);
        await save("audit", item.TrailARN, [obs("aws-trail-recording", status.IsLogging ? "pass" : "fail", "Configured CloudTrail recording state.", { isMultiRegion: item.IsMultiRegionTrail, lastDeliveryTime: status.LatestDeliveryTime?.toISOString(), managementSelectors: selectors.EventSelectors?.length ?? 0, advancedSelectors: selectors.AdvancedEventSelectors?.length ?? 0 }), obs("aws-trail-digests", item.LogFileValidationEnabled ? "pass" : "fail", "CloudTrail digest delivery configuration checked. This observation does not claim the delivered digest chain was cryptographically validated.")]);
        if (c.includeManagementEventSample === true) {
          const events = await invoke(trail, new LookupEventsCommand({ MaxResults: 10, StartTime: new Date(Date.now() - 86400000), EndTime: new Date() }));
          await save("audit", item.TrailARN, [obs("aws-audit-sample", "pass", `${events.Events?.length ?? 0} regional management events queried for the preceding 24 hours; data-event coverage is not implied.`, { eventNames: [...new Set((events.Events ?? []).map(event => event.EventName))] })]);
        }
      }
    }
    const sgIds = assets.filter(asset => asset.id.includes("security-group/")).map(asset => asset.id.split("/").at(-1));
    if (sgIds.length) {
      const security = await invoke(new EC2Client(config), new DescribeSecurityGroupsCommand({ GroupIds: sgIds.slice(0, 25) }));
      for (const group of security.SecurityGroups ?? []) {
        const exposed = group.IpPermissions?.some(permission => (permission.IpProtocol === "-1" || [22, 3389].some(port => permission.FromPort <= port && permission.ToPort >= port)) && (permission.IpRanges?.some(range => range.CidrIp === "0.0.0.0/0") || permission.Ipv6Ranges?.some(range => range.CidrIpv6 === "::/0")));
        await save("cloud", group.GroupId, [obs("aws-admin-ingress", exposed ? "fail" : "pass", "Security-group ingress reviewed for world-open SSH/RDP or all-protocol rules.")]);
      }
    }
    for (const asset of assets.filter(asset => asset.kind === "s3").slice(0, 8)) {
      const bucket = asset.id.split(":::")[1]; if (!bucket) continue;
      const s3 = new S3Client(config);
      const [publicAccess, crypto, versioning] = await Promise.allSettled([invoke(s3, new GetPublicAccessBlockCommand({ Bucket: bucket })), invoke(s3, new GetBucketEncryptionCommand({ Bucket: bucket })), invoke(s3, new GetBucketVersioningCommand({ Bucket: bucket }))]);
      await save("data", asset.id, [
        obs("aws-storage-public", publicAccess.status === "fulfilled" ? Object.values(publicAccess.value.PublicAccessBlockConfiguration ?? {}).length === 4 && Object.values(publicAccess.value.PublicAccessBlockConfiguration).every(Boolean) ? "pass" : "fail" : "not_assessed", "Scoped S3 bucket public-access-block settings."),
        obs("aws-storage-encryption", crypto.status === "fulfilled" && crypto.value.ServerSideEncryptionConfiguration?.Rules?.length ? "pass" : "not_assessed", "Scoped S3 bucket default encryption configuration."),
        obs("aws-storage-versioning", versioning.status === "fulfilled" ? versioning.value.Status === "Enabled" ? "pass" : "fail" : "not_assessed", "Scoped S3 bucket versioning configuration; recovery effectiveness needs a restore exercise."),
      ]);
    }
  }
  if (c.includeAccountIdentitySummary === true) {
    const iam = await invoke(new IAMClient({ region, credentials, maxAttempts: 1 }), new GetAccountSummaryCommand({}));
    await save("authentication", `aws-iam://${c.accountId}`, [obs("aws-root-mfa", iam.SummaryMap?.AccountMFAEnabled === 1 ? "pass" : "fail", "Explicitly opted-in account-level root MFA configuration." )]);
  }
}
