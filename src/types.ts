export interface Incident {
  id: string;
  service: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
  title: string;
  description: string;
  timestamp: string;
}

export interface Log {
  id: number;
  timestamp: string;
  service: string;
  severity: string;
  error_type: string | null;
  message: string;
  version: string;
  trace_id: string;
}

export interface Deployment {
  id: string;
  service: string;
  version: string;
  timestamp: string;
  status: string;
}

export interface AgentStep {
  type: 'thought' | 'tool_call' | 'tool_result' | 'report';
  content: string;
  timestamp: string;
  metadata?: any;
}
