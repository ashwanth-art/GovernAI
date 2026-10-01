# Wiring GitHub Actions to Azure

One-time setup for `.github/workflows/deploy.yml`. After this, a push to `main`
runs the test suite, builds the image in ACR, updates the container app, and
fails the run if the deployed URL does not come back healthy.

Authentication uses OIDC federated credentials: GitHub mints a short-lived token
for each run and Azure exchanges it for access. No client secret is created, so
there is nothing in the repository to leak or rotate.

## What is being connected

| | |
|---|---|
| Subscription | `75dba07a-55de-4b21-b6d5-d3d0a7ae79b5` (ACIINFOTECH-AZURE-SUBCRIPTION-DEMOS) |
| Tenant | `d6f9d045-6ad0-4ebf-ab1c-2a96c548a069` |
| Resource group | `rg-governai-demo` |
| Registry | `acrgovernaidemo` |
| Container app | `governai` |
| Repository | `ashwanth-art/GovernAI` |

## Step 1 — create the identity

Any member of the tenant can run this; the directory allows app registration
(`allowedToCreateApps` is true).

```bash
APP_ID=$(az ad app create \
  --display-name governai-github-deploy \
  --sign-in-audience AzureADMyOrg \
  --query appId -o tsv)

az ad sp create --id "$APP_ID"
echo "AZURE_CLIENT_ID = $APP_ID"
```

Keep `$APP_ID` — it goes into GitHub in step 4.

## Step 2 — trust the repository

The `subject` is what Azure checks the incoming GitHub token against. It is
scoped to `main`, so a run triggered from any other branch cannot authenticate.

```bash
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:ashwanth-art/GovernAI:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

To gate deploys behind a manual approval later, create a GitHub environment and
add a second credential with subject
`repo:ashwanth-art/GovernAI:environment:production`, then set `environment:
production` on the deploy job.

## Step 3 — grant permissions (needs Owner or User Access Administrator)

**This is the step an admin has to run.** `narendra.kalam@aciinfotech.com` holds
only `Contributor` on the subscription, and Contributor's `notActions` include
`Microsoft.Authorization/*/Write` — it cannot create role assignments.

Both grants are scoped to a single resource, not the resource group and not the
subscription. The identity can build images in this one registry and update this
one container app, and nothing else.

```bash
SUB=75dba07a-55de-4b21-b6d5-d3d0a7ae79b5
RG=rg-governai-demo

# Queue ACR build tasks. AcrPush is NOT sufficient on its own: it grants
# pull/read and push/write but not registries/scheduleRun/action, which is what
# `az acr build` calls. The task pushes the built image under the registry's own
# context, so the caller does not additionally need AcrPush — if a build ever
# reports it cannot push, add it.
az role assignment create \
  --assignee "$APP_ID" \
  --role "Container Registry Tasks Contributor" \
  --scope "/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.ContainerRegistry/registries/acrgovernaidemo"

# Update the container app's image.
az role assignment create \
  --assignee "$APP_ID" \
  --role "Container Apps Contributor" \
  --scope "/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.App/containerApps/governai"
```

## Step 4 — add the repository secrets

`Settings → Secrets and variables → Actions → New repository secret`:

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | the `$APP_ID` from step 1 |
| `AZURE_TENANT_ID` | `d6f9d045-6ad0-4ebf-ab1c-2a96c548a069` |
| `AZURE_SUBSCRIPTION_ID` | `75dba07a-55de-4b21-b6d5-d3d0a7ae79b5` |

None of these three are secrets in the cryptographic sense — they are
identifiers, and they are useless without the federated trust from step 2. They
live in Actions secrets because that is where the `azure/login` action reads
them from.

## Step 5 — confirm

Run the workflow manually from the Actions tab (`workflow_dispatch`) before
relying on it. A green run ends with the probe printing the live industry and
standard counts.

## If the deploy succeeds but the probe fails

The image deployed correctly and nothing is serving it. Check:

```bash
az containerapp show -n governai -g rg-governai-demo \
  --query "{runningStatus:properties.runningStatus,min:properties.template.scale.minReplicas}" -o json
```

`runningStatus: "Stopped"` means the app is parked — a deliberate stop, not a
scale-to-zero. Nothing wakes a stopped app, including inbound traffic, so ingress
returns an immediate 404. This az build has no `containerapp start`, so start it
through ARM:

```bash
az rest --method post --url "https://management.azure.com/subscriptions/75dba07a-55de-4b21-b6d5-d3d0a7ae79b5/resourceGroups/rg-governai-demo/providers/Microsoft.App/containerApps/governai/start?api-version=2024-03-01"
```
