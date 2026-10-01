/**
 * The monitor control surface.
 *
 * GET runs any cycle that has fallen due and then returns the state, so the schedule
 * is honoured by the act of looking rather than by a background worker this build does
 * not have. POST arms, disarms, forces a cycle, or clears history.
 *
 * Arming carries credentials in the request body, exactly as a run does. They go into
 * the monitor store's memory and are never returned: the response reports only whether
 * something is held, never what.
 */

import { validateAssessmentInput } from "@/lib/assessment";
import { writeExecutionLog } from "@/lib/execution-log";
import { resolveServerCredentials } from "@/lib/server-credentials";
import {
  armAll,
  armMonitor,
  clearHistory,
  disarmAll,
  disarmMonitor,
  monitorState,
  runCycle,
  runDueCycle,
  setCadence,
} from "@/lib/monitor-store";
import type { AssessmentInput, MonitorPlanEntry } from "@/lib/types";

export const runtime = "edge";

interface MonitorCommand {
  action:
    | "arm"
    | "arm_all"
    | "disarm"
    | "disarm_all"
    | "set_cadence"
    | "cycle"
    | "clear_history";
  monitorId?: string;
  /** `arm_all` only: arm this subset of the plan rather than all of it. */
  monitorIds?: string[];
  cadenceSeconds?: number;
  /** `arm_all` only: per-monitor intervals, keyed by monitor id. */
  cadences?: Record<string, number>;
  input?: AssessmentInput;
  plan?: MonitorPlanEntry[];
}

export async function GET() {
  const startedMs = Date.now();
  await runDueCycle();
  const state = monitorState();
  writeExecutionLog({
    module: "app/api/monitors/route",
    functionName: "GET",
    executionStage: "monitor_state_read",
    inputSummary: "monitor state read",
    outputSummary: `armed=${state.armed.length}; cycles=${state.cyclesRun}; alerts=${state.alerts.length}`,
    durationMs: Date.now() - startedMs,
    status: "success",
  });
  return Response.json(state);
}

export async function POST(request: Request) {
  const startedMs = Date.now();
  let command: MonitorCommand;
  try {
    command = (await request.json()) as MonitorCommand;
  } catch {
    return Response.json({ errors: ["Request body must be valid JSON."] }, { status: 400 });
  }

  const fail = (errors: string[], status = 422) => {
    writeExecutionLog({
      module: "app/api/monitors/route",
      functionName: "POST",
      executionStage: "monitor_command_rejected",
      inputSummary: `action=${command.action ?? "none"}`,
      outputSummary: `HTTP ${status}`,
      durationMs: Date.now() - startedMs,
      status: "failure",
      errorDetails: errors.join("; "),
    });
    return Response.json({ errors }, { status });
  };

  switch (command.action) {
    case "arm": {
      if (!command.monitorId) return fail(["A monitor id is required to arm a monitor."]);
      if (!command.input) return fail(["Arming needs the same input the run used."]);
      if (!command.plan?.length) return fail(["Arming needs the monitor plan from the run."]);
      // The same validation a run goes through. A monitor that would fail at run time
      // must fail at arm time, or it would sit armed and quietly never work.
      command.input = resolveServerCredentials(command.input);
      const errors = validateAssessmentInput(command.input);
      if (errors.length) return fail(errors);
      const armed = armMonitor(
        command.monitorId,
        command.input,
        command.plan,
        command.cadenceSeconds,
      );
      if (!armed.ok) return fail([armed.error ?? "The monitor could not be armed."]);
      break;
    }
    case "arm_all": {
      if (!command.input) return fail(["Arming needs the same input the run used."]);
      if (!command.plan?.length) return fail(["Arming needs the monitor plan from the run."]);
      command.input = resolveServerCredentials(command.input);
      const errors = validateAssessmentInput(command.input);
      if (errors.length) return fail(errors);
      const armed = armAll(
        command.input,
        command.plan,
        command.cadenceSeconds,
        command.monitorIds,
        command.cadences,
      );
      if (!armed.ok) return fail([armed.error ?? "The monitors could not be armed."]);
      break;
    }
    case "disarm": {
      if (!command.monitorId) return fail(["A monitor id is required to disarm a monitor."]);
      disarmMonitor(command.monitorId);
      break;
    }
    case "set_cadence": {
      // Changing an interval carries no credentials, which is the point of having it
      // as its own action rather than re-arming.
      if (!command.monitorId) return fail(["A monitor id is required to set an interval."]);
      if (command.cadenceSeconds === undefined) return fail(["An interval in seconds is required."]);
      const changed = setCadence(command.monitorId, command.cadenceSeconds);
      if (!changed.ok) return fail([changed.error ?? "The interval could not be changed."]);
      break;
    }
    case "disarm_all":
      disarmAll();
      break;
    case "clear_history":
      clearHistory();
      break;
    case "cycle": {
      const cycled = await runCycle("manual");
      if (!cycled.ok) return fail([cycled.error ?? "The cycle could not be run."], 409);
      break;
    }
    default:
      return fail(
        [
          "Unknown action. Use arm, arm_all, disarm, disarm_all, set_cadence, cycle or " +
            "clear_history.",
        ],
        400,
      );
  }

  const state = monitorState();
  writeExecutionLog({
    module: "app/api/monitors/route",
    functionName: "POST",
    executionStage: "monitor_command",
    inputSummary: `action=${command.action}; monitor=${command.monitorId ?? "n/a"}`,
    outputSummary: `armed=${state.armed.length}; cycles=${state.cyclesRun}; alerts=${state.alerts.length}`,
    durationMs: Date.now() - startedMs,
    status: "success",
  });
  return Response.json(state);
}
