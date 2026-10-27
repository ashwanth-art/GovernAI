/** Provision via a DBA-owned migration, then grant the gateway only the
 * minimum SELECT/INSERT/UPDATE rights. Approval issuance belongs to a separate
 * authenticated human workflow; this module exposes no approval-creation API. */
export const agentStateSchema = `
CREATE SCHEMA IF NOT EXISTS arq_agent_security;
CREATE TABLE IF NOT EXISTS arq_agent_security.approvals (
 id text PRIMARY KEY, binding text NOT NULL, tenant_id text NOT NULL,
 requester text NOT NULL, approver text NOT NULL CHECK (approver <> requester),
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS arq_agent_security.revocations (
 kind text NOT NULL CHECK (kind IN ('subject','agent','token','tenant','global')),
 identity_id text NOT NULL, PRIMARY KEY(kind, identity_id)
);
CREATE TABLE IF NOT EXISTS arq_agent_security.budgets (
 identity_key text NOT NULL, window_start timestamptz NOT NULL,
 calls integer NOT NULL CHECK (calls > 0), PRIMARY KEY(identity_key, window_start)
);
CREATE TABLE IF NOT EXISTS arq_agent_security.audit (
 id bigserial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(), event jsonb NOT NULL
);`;

export function postgresAgentState(pool) {
  return {
    async isRevoked(identity) {
      const result = await pool.query("SELECT 1 FROM arq_agent_security.revocations WHERE (kind,identity_id) IN (('subject',$1),('agent',$2),('token',$3),('tenant',$4),('global','*')) LIMIT 1", [identity.subject, identity.agentId, identity.tokenId, identity.tenantId]);
      return result.rowCount > 0;
    },
    async reserve({ subject, agentId, tenantId, tool, limit }) {
      // Collision-free JSON tuple rather than concatenating attacker-controlled
      // identifiers. PostgreSQL's conflict update is atomic across replicas.
      const key = JSON.stringify([subject, agentId, tenantId, tool]);
      const result = await pool.query(`INSERT INTO arq_agent_security.budgets(identity_key,window_start,calls) VALUES($1,date_trunc('minute',now()),1)
        ON CONFLICT(identity_key,window_start) DO UPDATE SET calls=arq_agent_security.budgets.calls+1 WHERE arq_agent_security.budgets.calls < $2 RETURNING calls`, [key, limit]);
      return result.rowCount === 1;
    },
    async consumeApproval({ id, binding, identity }) {
      const result = await pool.query(`UPDATE arq_agent_security.approvals SET consumed_at=now() WHERE id=$1 AND binding=$2 AND tenant_id=$3 AND requester=$4 AND approver<>$4 AND consumed_at IS NULL AND expires_at>now() RETURNING id`, [id, binding, identity.tenantId, identity.subject]);
      return result.rowCount === 1;
    },
    async audit(event) { await pool.query("INSERT INTO arq_agent_security.audit(event) VALUES($1::jsonb)", [JSON.stringify(event)]); },
  };
}
