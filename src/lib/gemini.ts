import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const model = "gemini-3-flash-preview";

export interface SearchParams {
  service?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface ESQLParams {
  sql: string;
}

export const searchLogs = async (params: SearchParams) => {
  const queryParams = new URLSearchParams();
  if (params.service) queryParams.append("service", params.service);
  if (params.start) queryParams.append("start", params.start);
  if (params.end) queryParams.append("end", params.end);
  if (params.limit) queryParams.append("limit", params.limit.toString());

  const res = await fetch(`/api/logs?${queryParams.toString()}`);
  return res.json();
};

export const runESQL = async (params: ESQLParams) => {
  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: params.sql }),
  });
  return res.json();
};

export const getDeployments = async () => {
  const res = await fetch("/api/deployments");
  return res.json();
};

export const runWorkflowAction = async (params: { incident_id: string; action_type: string; details: string }) => {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
};

export const getMetrics = async (params: { service: string }) => {
  const res = await fetch(`/api/metrics?service=${params.service}`);
  return res.json();
};

export const tools = [
  {
    name: "search_logs",
    description: "Search through system logs with filters for service, time range, and limit.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: { type: Type.STRING, description: "The name of the service (e.g., 'payments-api')" },
        start: { type: Type.STRING, description: "Start timestamp (ISO format)" },
        end: { type: Type.STRING, description: "End timestamp (ISO format)" },
        limit: { type: Type.NUMBER, description: "Max number of logs to return" },
      },
    },
  },
  {
    name: "run_esql_analytics",
    description: "Run advanced analytics using ES|QL (SQL-like) syntax on logs and metrics.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sql: { type: Type.STRING, description: "The SQL query to run against the logs/metrics tables." },
      },
      required: ["sql"],
    },
  },
  {
    name: "get_deployments",
    description: "Get recent deployment history to check for correlation with incidents.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "get_metrics",
    description: "Retrieve system metrics (CPU, Memory, etc.) for a specific service.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: { type: Type.STRING, description: "The name of the service." },
      },
      required: ["service"],
    },
  },
  {
    name: "workflow_action",
    description: "Trigger a remediation workflow action like restarting a service or rolling back a deployment.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        incident_id: { type: Type.STRING, description: "The ID of the incident being investigated." },
        action_type: { type: Type.STRING, description: "Type of action: 'RESTART', 'ROLLBACK', 'TICKET', 'NOTIFY'" },
        details: { type: Type.STRING, description: "Additional details for the action." },
      },
      required: ["incident_id", "action_type", "details"],
    },
  },
];
