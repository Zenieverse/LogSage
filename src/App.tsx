import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  AlertCircle, 
  Terminal, 
  Database, 
  Play, 
  RefreshCcw, 
  History, 
  Bell, 
  Ticket, 
  ChevronRight,
  Search,
  Cpu,
  CheckCircle2,
  Clock,
  Layers,
  BarChart3,
  Shield,
  Zap,
  Settings,
  User,
  LayoutDashboard,
  Eye,
  Workflow,
  ShieldCheck,
  Lock,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { cn } from './lib/utils';
import { Incident, Log, AgentStep, Deployment } from './types';
import { tools, searchLogs, runESQL, getDeployments, model, getMetrics, runWorkflowAction } from './lib/gemini';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';

export default function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'investigation' | 'discover' | 'metrics'>('investigation');
  const [rightPanelTab, setRightPanelTab] = useState<'logs' | 'traces'>('logs');
  const [searchTerm, setSearchTerm] = useState('');
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'discover' | 'analytics' | 'security' | 'settings'>('dashboard');
  const [settings, setSettings] = useState({
    autoRemediate: false,
    slackNotifications: true,
    logRetention: '30',
    agentModel: 'gemini-3-flash-preview'
  });
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchIncidents();
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSettingsChange = (key: keyof typeof settings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    showNotification(`Settings updated: ${key}`);
  };

  const fetchIncidents = async () => {
    try {
      const res = await fetch('/api/incidents');
      const data = await res.json();
      setIncidents(data);
    } catch (e) {
      console.error("Failed to fetch incidents", e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs?limit=100');
      const data = await res.json();
      setLogs(data);
      showNotification("Logs refreshed");
    } catch (e) {
      console.error("Failed to fetch logs", e);
    }
  };

  const handleResolve = async () => {
    if (!selectedIncident) return;
    try {
      const res = await fetch(`/api/incidents/${selectedIncident.id}/resolve`, { method: 'POST' });
      if (res.ok) {
        showNotification(`Incident ${selectedIncident.id} resolved successfully`);
        fetchIncidents();
        setSelectedIncident(prev => prev ? { ...prev, status: 'RESOLVED' } : null);
      }
    } catch (e) {
      showNotification("Failed to resolve incident", "error");
    }
  };

  const handleAction = async (type: string) => {
    if (!selectedIncident) return;
    try {
      const res = await runWorkflowAction({
        incident_id: selectedIncident.id,
        action_type: type,
        details: `Manual trigger from dashboard for ${selectedIncident.service}`
      });
      if (res.status === 'COMPLETED') {
        showNotification(`${type} action executed successfully`);
      }
    } catch (e) {
      showNotification(`Failed to execute ${type}`, "error");
    }
  };

  const filteredIncidents = incidents.filter(inc => 
    inc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inc.service.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inc.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const fetchServiceMetrics = async (service: string) => {
    const data = await getMetrics({ service });
    setMetrics(data);
  };

  const runInvestigation = async (incident: Incident) => {
    setIsInvestigating(true);
    setAgentSteps([]);
    setLogs([]);
    fetchServiceMetrics(incident.service);
    
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    const chat = ai.chats.create({
      model: model,
      config: {
        systemInstruction: `You are LogSage, a world-class autonomous DevOps incident investigation platform.
        Your mission is to investigate production incidents using Elasticsearch logs, ES|QL analytics, and system metrics.
        
        Investigation Protocol:
        1. ANALYZE: Understand the incident title and description.
        2. RETRIEVE: Use 'search_logs' to get logs for the service around the incident time.
        3. ANALYZE METRICS: Use 'get_metrics' to check CPU/Memory trends.
        4. ANALYTICS: Use 'run_esql_analytics' to find error spikes or pattern correlations.
        5. CORRELATE: Use 'get_deployments' to see if a recent change caused the issue.
        6. REMEDIATE: If a clear fix is identified (e.g., rollback for a bad deploy), use 'workflow_action' to trigger it.
        7. REPORT: Provide a structured "Incident Investigation Report" in Markdown.
        
        Always explain your reasoning before calling a tool.
        Be precise, technical, and decisive.`,
        tools: [{ functionDeclarations: tools as any }],
      }
    });

    try {
      let message = `Investigate this incident:
      ID: ${incident.id}
      Service: ${incident.service}
      Title: ${incident.title}
      Description: ${incident.description}
      Timestamp: ${incident.timestamp}`;

      let finished = false;
      let iterations = 0;

      while (!finished && iterations < 12) {
        iterations++;
        const response: GenerateContentResponse = await chat.sendMessage({ message });
        
        if (response.text) {
          setAgentSteps(prev => [...prev, {
            type: 'thought',
            content: response.text || "",
            timestamp: new Date().toISOString()
          }]);
        }

        const calls = response.functionCalls;
        if (calls && calls.length > 0) {
          const toolResults = [];
          for (const call of calls) {
            setAgentSteps(prev => [...prev, {
              type: 'tool_call',
              content: `Executing ${call.name}...`,
              timestamp: new Date().toISOString(),
              metadata: call.args
            }]);

            let result;
            try {
              if (call.name === 'search_logs') {
                result = await searchLogs(call.args as any);
                if (Array.isArray(result)) setLogs(result);
              } else if (call.name === 'run_esql_analytics') {
                result = await runESQL(call.args as any);
              } else if (call.name === 'get_deployments') {
                result = await getDeployments();
              } else if (call.name === 'get_metrics') {
                result = await getMetrics(call.args as any);
                setMetrics(result);
              } else if (call.name === 'workflow_action') {
                result = await runWorkflowAction(call.args as any);
              }

              setAgentSteps(prev => [...prev, {
                type: 'tool_result',
                content: `Tool ${call.name} completed.`,
                timestamp: new Date().toISOString(),
                metadata: result
              }]);

              toolResults.push({
                name: call.name,
                response: { result },
                id: call.id
              });
            } catch (err: any) {
              toolResults.push({
                name: call.name,
                response: { error: err.message },
                id: call.id
              });
            }
          }

          const toolResponse = await chat.sendMessage({
            message: {
              role: 'user',
              parts: toolResults.map(r => ({
                functionResponse: {
                  name: r.name,
                  response: r.response
                }
              }))
            } as any
          });
          
          if (toolResponse.text) {
             setAgentSteps(prev => [...prev, {
              type: 'thought',
              content: toolResponse.text || "",
              timestamp: new Date().toISOString()
            }]);
          }
          
          if (toolResponse.text?.includes("Incident Investigation Report")) finished = true;
          message = "Proceed with the next step of the investigation.";
        } else {
          finished = true;
        }
      }
    } catch (error: any) {
      setAgentSteps(prev => [...prev, {
        type: 'thought',
        content: `Critical Error: ${error.message}`,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsInvestigating(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0D0E12] text-slate-300 font-sans selection:bg-indigo-500/30 overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-16 border-r border-slate-800 flex flex-col items-center py-6 gap-8 bg-[#15161A]">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Zap className="text-white w-6 h-6 fill-current" />
        </div>
        <div className="flex flex-col gap-6">
          <button 
            onClick={() => setCurrentView('dashboard')}
            className={cn("p-2 rounded-lg transition-all", currentView === 'dashboard' ? "text-indigo-500 bg-indigo-500/10" : "text-slate-500 hover:text-slate-300")}
          >
            <LayoutDashboard className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setCurrentView('discover')}
            className={cn("p-2 rounded-lg transition-all", currentView === 'discover' ? "text-indigo-500 bg-indigo-500/10" : "text-slate-500 hover:text-slate-300")}
          >
            <Eye className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setCurrentView('analytics')}
            className={cn("p-2 rounded-lg transition-all", currentView === 'analytics' ? "text-indigo-400 bg-indigo-500/10" : "text-slate-500 hover:text-slate-300")}
          >
            <BarChart3 className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setCurrentView('security')}
            className={cn("p-2 rounded-lg transition-all", currentView === 'security' ? "text-indigo-400 bg-indigo-500/10" : "text-slate-500 hover:text-slate-300")}
          >
            <Shield className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-auto flex flex-col gap-6">
          <button 
            onClick={() => setCurrentView('settings')}
            className={cn("p-2 rounded-lg transition-all", currentView === 'settings' ? "text-indigo-400 bg-indigo-500/10" : "text-slate-500 hover:text-slate-300")}
          >
            <Settings className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
            <User className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Incident List Panel */}
      <div className="w-80 border-r border-slate-800 flex flex-col bg-[#15161A]">
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h1 className="font-bold text-slate-100 text-lg tracking-tight">LogSage</h1>
            <div className="flex gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">Live</span>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Filter incidents..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-800 rounded-lg py-2 pl-10 pr-4 text-xs focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800/50 bg-slate-800/10">Active Incidents</div>
          {filteredIncidents.map(inc => (
            <button
              key={inc.id}
              onClick={() => {
                setSelectedIncident(inc);
                if (!isInvestigating) runInvestigation(inc);
              }}
              className={cn(
                "w-full text-left p-5 border-b border-slate-800/50 transition-all hover:bg-slate-800/30 group relative",
                selectedIncident?.id === inc.id ? "bg-indigo-500/5" : ""
              )}
            >
              {selectedIncident?.id === inc.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />}
              <div className="flex justify-between items-start mb-2">
                <span className={cn(
                  "text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-tighter",
                  inc.severity === 'CRITICAL' ? "bg-red-500/20 text-red-400 border border-red-500/20" : 
                  inc.severity === 'HIGH' ? "bg-orange-500/20 text-orange-400 border border-orange-500/20" : 
                  "bg-blue-500/20 text-blue-400 border border-blue-500/20"
                )}>
                  {inc.severity}
                </span>
                <span className="text-[10px] text-slate-600 font-mono">{format(new Date(inc.timestamp), 'HH:mm')}</span>
              </div>
              <div className="font-semibold text-slate-200 text-sm group-hover:text-indigo-400 transition-colors leading-tight">{inc.title}</div>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                <div className="text-[11px] text-slate-500 font-medium">{inc.service}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-[#0D0E12] relative overflow-hidden">
        {currentView === 'dashboard' ? (
          <>
            {/* Top Header */}
            <div className="h-16 border-b border-slate-800 flex items-center px-8 justify-between bg-[#15161A]/80 backdrop-blur-xl sticky top-0 z-20">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <Workflow className={cn("w-5 h-5", isInvestigating ? "text-indigo-400 animate-spin" : "text-slate-500")} />
                  <h2 className="text-sm font-bold text-slate-100 uppercase tracking-widest">Investigation Engine</h2>
                </div>
                <div className="h-4 w-px bg-slate-800" />
                <div className="flex gap-4">
                  <button 
                    onClick={() => setActiveTab('investigation')}
                    className={cn("text-xs font-bold transition-colors", activeTab === 'investigation' ? "text-indigo-400" : "text-slate-500 hover:text-slate-300")}
                  >
                    REASONING
                  </button>
                  <button 
                    onClick={() => setActiveTab('metrics')}
                    className={cn("text-xs font-bold transition-colors", activeTab === 'metrics' ? "text-indigo-400" : "text-slate-500 hover:text-slate-300")}
                  >
                    METRICS
                  </button>
                </div>
              </div>
              
              {selectedIncident && (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 border border-slate-700 rounded-lg">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span className="text-[11px] font-mono text-slate-400">MTTR: 14m 22s</span>
                  </div>
                  <button 
                    onClick={handleResolve}
                    disabled={selectedIncident.status === 'RESOLVED'}
                    className={cn(
                      "px-4 py-1.5 text-xs font-bold rounded-lg transition-all shadow-lg",
                      selectedIncident.status === 'RESOLVED' 
                        ? "bg-slate-800 text-slate-500 cursor-not-allowed" 
                        : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20"
                    )}
                  >
                    {selectedIncident.status === 'RESOLVED' ? 'RESOLVED' : 'RESOLVE INCIDENT'}
                  </button>
                </div>
              )}
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              {!selectedIncident ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-700">
                  <div className="w-24 h-24 bg-slate-900/50 rounded-full flex items-center justify-center mb-6 border border-slate-800">
                    <Terminal className="w-10 h-10 opacity-20" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-400 mb-2">Awaiting Incident Selection</h3>
                  <p className="text-sm max-w-xs text-center opacity-50">Select an incident from the left panel to begin autonomous investigation.</p>
                </div>
              ) : (
                <div className="max-w-5xl mx-auto space-y-8">
                  {/* Incident Header Card */}
                  <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                      <AlertCircle className="w-32 h-32" />
                    </div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-red-500/10 rounded-lg border border-red-500/20">
                        <AlertCircle className="w-5 h-5 text-red-500" />
                      </div>
                      <span className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Incident Context</span>
                    </div>
                    <h3 className="text-2xl font-black text-slate-100 mb-2 tracking-tight">{selectedIncident.title}</h3>
                    <div className="flex items-center gap-4 text-sm text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-indigo-500" />
                        <span>{selectedIncident.service}</span>
                      </div>
                      <div className="w-1 h-1 rounded-full bg-slate-700" />
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-slate-500" />
                        <span>Started {format(new Date(selectedIncident.timestamp), 'MMM d, HH:mm')}</span>
                      </div>
                    </div>
                    <p className="mt-4 text-slate-400 leading-relaxed max-w-2xl">{selectedIncident.description}</p>
                  </div>

                  {activeTab === 'investigation' ? (
                    <div className="space-y-6">
                      {agentSteps.map((step, i) => (
                        <div key={i} className="flex gap-6">
                          <div className="flex flex-col items-center">
                            <div className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center border shadow-lg transition-all",
                              step.type === 'thought' ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400" :
                              step.type === 'tool_call' ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                              "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                            )}>
                              {step.type === 'thought' ? <Cpu className="w-5 h-5" /> : 
                               step.type === 'tool_call' ? <Database className="w-5 h-5" /> : 
                               <CheckCircle2 className="w-4 h-4" />}
                            </div>
                            <div className="flex-1 w-px bg-slate-800/50 my-3" />
                          </div>
                          <div className="flex-1 pb-8">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                {step.type === 'thought' ? 'Agent Reasoning' : 
                                 step.type === 'tool_call' ? 'Tool Execution' : 'Tool Result'}
                              </span>
                              <div className="h-px flex-1 bg-slate-800/50" />
                              <span className="text-[10px] text-slate-700 font-mono">{format(new Date(step.timestamp), 'HH:mm:ss.SSS')}</span>
                            </div>
                            <div className={cn(
                              "rounded-xl p-5 border transition-all",
                              step.type === 'thought' ? "bg-slate-900/30 border-slate-800" : "bg-black/40 border-slate-800/50 font-mono text-[11px]"
                            )}>
                              {step.type === 'thought' ? (
                                <div className="markdown-body prose prose-invert prose-sm max-w-none">
                                  <Markdown>{step.content}</Markdown>
                                </div>
                              ) : (
                                <div className="text-slate-500 break-all">
                                  <span className="text-indigo-400 mr-2">$</span>
                                  {step.content}
                                  {step.metadata && (
                                    <pre className="mt-3 p-3 bg-black/60 rounded border border-slate-800 overflow-x-auto text-slate-400">
                                      {JSON.stringify(step.metadata, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {isInvestigating && (
                        <div className="flex gap-6 animate-pulse">
                          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700" />
                          <div className="flex-1 h-24 bg-slate-900/50 rounded-xl border border-slate-800" />
                        </div>
                      )}
                      <div ref={stepsEndRef} />
                    </div>
                  ) : (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">CPU Usage (%)</h4>
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={metrics.filter(m => m.metric_name === 'cpu_usage')}>
                                <defs>
                                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="timestamp" hide />
                                <YAxis stroke="#475569" fontSize={10} />
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }} />
                                <Area type="monotone" dataKey="value" stroke="#6366f1" fillOpacity={1} fill="url(#colorCpu)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Memory Usage (GB)</h4>
                          <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={metrics.filter(m => m.metric_name === 'memory_usage')}>
                                <defs>
                                  <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="timestamp" hide />
                                <YAxis stroke="#475569" fontSize={10} />
                                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }} />
                                <Area type="monotone" dataKey="value" stroke="#ec4899" fillOpacity={1} fill="url(#colorMem)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : currentView === 'discover' ? (
          <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
            <div className="h-16 border-b border-slate-800 flex items-center px-8 justify-between bg-[#15161A]">
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-100 uppercase tracking-widest">Discover Explorer</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input 
                    type="text" 
                    placeholder="Search logs..." 
                    className="bg-slate-900 border border-slate-800 rounded-lg py-1.5 pl-10 pr-4 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50 w-64"
                  />
                </div>
                <button 
                  onClick={fetchLogs}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg border border-slate-700 transition-all"
                >
                  REFRESH
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-8 custom-scrollbar">
              <div className="bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-800/50 border-b border-slate-800">
                      <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Timestamp</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Service</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Level</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {logs.length > 0 ? logs.map((log, i) => (
                      <tr key={i} className="hover:bg-slate-800/20 transition-colors">
                        <td className="px-6 py-4 text-[11px] font-mono text-slate-500 whitespace-nowrap">{format(new Date(log.timestamp), 'HH:mm:ss.SSS')}</td>
                        <td className="px-6 py-4 text-[11px] font-bold text-indigo-400">{log.service}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[9px] font-black uppercase",
                            log.severity === 'ERROR' ? "bg-red-500/10 text-red-500" :
                            log.severity === 'WARN' ? "bg-amber-500/10 text-amber-500" :
                            "bg-emerald-500/10 text-emerald-500"
                          )}>
                            {log.severity}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[11px] text-slate-400 font-mono truncate max-w-md">{log.message}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-slate-600 italic text-xs">No logs found in the current index.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : currentView === 'analytics' ? (
          <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
            <div className="h-16 border-b border-slate-800 flex items-center px-8 justify-between bg-[#15161A]">
              <div className="flex items-center gap-3">
                <BarChart3 className="w-5 h-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-100 uppercase tracking-widest">Platform Analytics</h2>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-12 custom-scrollbar">
              <div className="grid grid-cols-3 gap-8 mb-12">
                <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-6">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Total Incidents</div>
                  <div className="text-4xl font-black text-slate-100">{incidents.length}</div>
                  <div className="mt-4 flex items-center gap-2 text-emerald-500 text-[10px] font-bold">
                    <TrendingUp className="w-3 h-3" />
                    <span>+12% from last week</span>
                  </div>
                </div>
                <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-6">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Avg. MTTR</div>
                  <div className="text-4xl font-black text-slate-100">14m</div>
                  <div className="mt-4 flex items-center gap-2 text-emerald-500 text-[10px] font-bold">
                    <TrendingDown className="w-3 h-3" />
                    <span>-4m from last week</span>
                  </div>
                </div>
                <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-6">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Agent Success Rate</div>
                  <div className="text-4xl font-black text-slate-100">94.2%</div>
                  <div className="mt-4 flex items-center gap-2 text-emerald-500 text-[10px] font-bold">
                    <Zap className="w-3 h-3" />
                    <span>Autonomous remediation active</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-8">
                <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] mb-8">Service Health Overview</h4>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: 'Payments', errors: 4, latency: 120 },
                      { name: 'Auth', errors: 2, latency: 45 },
                      { name: 'Inventory', errors: 8, latency: 210 },
                      { name: 'Gateway', errors: 1, latency: 30 },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="name" stroke="#475569" fontSize={10} />
                      <YAxis stroke="#475569" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b' }} />
                      <Bar dataKey="errors" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="latency" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        ) : currentView === 'security' ? (
          <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-500">
            <div className="h-16 border-b border-slate-800 flex items-center px-8 justify-between bg-[#15161A]">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-100 uppercase tracking-widest">Security Posture</h2>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-12 custom-scrollbar">
              <div className="max-w-4xl mx-auto space-y-12">
                <div className="grid grid-cols-2 gap-8">
                  <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-8 flex items-center gap-6">
                    <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20">
                      <ShieldCheck className="w-8 h-8 text-emerald-500" />
                    </div>
                    <div>
                      <div className="text-2xl font-black text-slate-100">Healthy</div>
                      <div className="text-xs text-slate-500 uppercase tracking-widest font-bold">System Integrity</div>
                    </div>
                  </div>
                  <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-8 flex items-center gap-6">
                    <div className="w-16 h-16 bg-indigo-500/10 rounded-2xl flex items-center justify-center border border-indigo-500/20">
                      <Lock className="w-8 h-8 text-indigo-500" />
                    </div>
                    <div>
                      <div className="text-2xl font-black text-slate-100">Enforced</div>
                      <div className="text-xs text-slate-500 uppercase tracking-widest font-bold">Access Control</div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="px-8 py-6 border-b border-slate-800 bg-slate-800/20 flex items-center justify-between">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Recent Security Events</h4>
                    <span className="px-2 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] font-black rounded">ALL CLEAR</span>
                  </div>
                  <div className="p-8 space-y-6">
                    {[
                      { event: 'SSH Login', user: 'admin', status: 'Success', time: '2m ago' },
                      { event: 'Policy Update', user: 'system', status: 'Applied', time: '1h ago' },
                      { event: 'Key Rotation', user: 'vault', status: 'Success', time: '4h ago' },
                    ].map((ev, i) => (
                      <div key={i} className="flex items-center justify-between py-4 border-b border-slate-800/50 last:border-0">
                        <div className="flex items-center gap-4">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <div>
                            <div className="text-sm font-bold text-slate-200">{ev.event}</div>
                            <div className="text-[10px] text-slate-500 uppercase tracking-widest">User: {ev.user}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-mono text-slate-400">{ev.time}</div>
                          <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">{ev.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : currentView === 'settings' ? (
          <div className="p-12 max-w-3xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h2 className="text-3xl font-black text-slate-100 mb-2 tracking-tight">Settings</h2>
              <p className="text-slate-500">Configure your LogSage autonomous agent and platform preferences.</p>
            </div>

            <div className="space-y-8">
              <section className="space-y-4">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Agent Configuration</h3>
                <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-200">Autonomous Remediation</div>
                      <div className="text-xs text-slate-500">Allow agent to trigger rollback/restart actions without approval.</div>
                    </div>
                    <button 
                      onClick={() => handleSettingsChange('autoRemediate', !settings.autoRemediate)}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        settings.autoRemediate ? "bg-indigo-600" : "bg-slate-800"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 bg-white rounded-full absolute top-1 transition-all",
                        settings.autoRemediate ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>
                  <div className="h-px bg-slate-800" />
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-200">Agent Model</div>
                      <div className="text-xs text-slate-500">The LLM powering the investigation reasoning.</div>
                    </div>
                    <select 
                      value={settings.agentModel}
                      onChange={(e) => handleSettingsChange('agentModel', e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                    </select>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Notifications</h3>
                <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-200">Slack Integration</div>
                      <div className="text-xs text-slate-500">Send investigation reports to #devops-alerts.</div>
                    </div>
                    <button 
                      onClick={() => handleSettingsChange('slackNotifications', !settings.slackNotifications)}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        settings.slackNotifications ? "bg-indigo-600" : "bg-slate-800"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 bg-white rounded-full absolute top-1 transition-all",
                        settings.slackNotifications ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">Data Management</h3>
                <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-200">Log Retention (Days)</div>
                      <div className="text-xs text-slate-500">How long to store investigation evidence.</div>
                    </div>
                    <input 
                      type="number" 
                      value={settings.logRetention}
                      onChange={(e) => handleSettingsChange('logRetention', e.target.value)}
                      className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-700">
            <div className="w-24 h-24 bg-slate-900/50 rounded-full flex items-center justify-center mb-6 border border-slate-800">
              <Zap className="w-10 h-10 opacity-20" />
            </div>
            <h3 className="text-lg font-bold text-slate-400 mb-2 uppercase tracking-widest">{currentView} View</h3>
            <p className="text-sm max-w-xs text-center opacity-50">This module is part of the LogSage Enterprise suite. Contact sales to enable advanced {currentView} capabilities.</p>
            <button 
              onClick={() => setCurrentView('dashboard')}
              className="mt-8 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all border border-slate-700"
            >
              RETURN TO DASHBOARD
            </button>
          </div>
        )}
      </div>

      {/* Right Panel: Logs & Actions */}
      <div className="w-96 border-l border-slate-800 flex flex-col bg-[#15161A]">
        <div className="h-16 border-b border-slate-800 flex items-center px-6 gap-6 bg-[#15161A]">
          <button 
            onClick={() => setRightPanelTab('logs')}
            className={cn(
              "text-xs font-black h-full px-2 transition-all",
              rightPanelTab === 'logs' ? "text-slate-100 border-b-2 border-indigo-500" : "text-slate-500 hover:text-slate-300"
            )}
          >
            EVIDENCE LOGS
          </button>
          <button 
            onClick={() => setRightPanelTab('traces')}
            className={cn(
              "text-xs font-black h-full px-2 transition-all",
              rightPanelTab === 'traces' ? "text-slate-100 border-b-2 border-indigo-500" : "text-slate-500 hover:text-slate-300"
            )}
          >
            TRACES
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {rightPanelTab === 'traces' ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-700 opacity-30">
              <Activity className="w-12 h-12 mb-4" />
              <p className="text-[10px] uppercase tracking-[0.3em] font-black">No Traces Available</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-700 opacity-30">
              <Layers className="w-12 h-12 mb-4" />
              <p className="text-[10px] uppercase tracking-[0.3em] font-black">No Logs Captured</p>
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="group p-4 bg-slate-900/30 border border-slate-800/50 rounded-xl font-mono text-[10px] hover:border-slate-700 transition-all hover:bg-slate-900/50">
                <div className="flex justify-between mb-2">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-black uppercase",
                    log.severity === 'ERROR' ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                  )}>{log.severity}</span>
                  <span className="text-slate-600 group-hover:text-slate-400 transition-colors">{format(new Date(log.timestamp), 'HH:mm:ss.SSS')}</span>
                </div>
                <div className="text-slate-300 leading-relaxed break-all">{log.message}</div>
                {log.error_type && <div className="text-indigo-400 mt-2 flex items-center gap-1.5">
                  <Zap className="w-3 h-3" />
                  <span>{log.error_type}</span>
                </div>}
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-800/50 text-slate-600">
                  <span className="bg-slate-800 px-1.5 py-0.5 rounded">v{log.version}</span>
                  <span className="truncate">{log.trace_id}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Action Panel */}
        <div className="p-6 border-t border-slate-800 bg-[#0D0E12]/80 backdrop-blur-md">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Remediation Actions</div>
            <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => handleAction('RESTART')}
              className="flex items-center justify-center gap-2.5 px-4 py-3 bg-slate-800/50 hover:bg-slate-700 text-slate-200 rounded-xl text-[11px] font-bold transition-all border border-slate-700/50 hover:border-indigo-500/30"
            >
              <RefreshCcw className="w-3.5 h-3.5 text-indigo-400" />
              RESTART
            </button>
            <button 
              onClick={() => handleAction('ROLLBACK')}
              className="flex items-center justify-center gap-2.5 px-4 py-3 bg-slate-800/50 hover:bg-slate-700 text-slate-200 rounded-xl text-[11px] font-bold transition-all border border-slate-700/50 hover:border-orange-500/30"
            >
              <History className="w-3.5 h-3.5 text-orange-400" />
              ROLLBACK
            </button>
            <button 
              onClick={() => handleAction('TICKET')}
              className="flex items-center justify-center gap-2.5 px-4 py-3 bg-slate-800/50 hover:bg-slate-700 text-slate-200 rounded-xl text-[11px] font-bold transition-all border border-slate-700/50 hover:border-blue-500/30"
            >
              <Ticket className="w-3.5 h-3.5 text-blue-400" />
              TICKET
            </button>
            <button 
              onClick={() => handleAction('NOTIFY')}
              className="flex items-center justify-center gap-2.5 px-4 py-3 bg-slate-800/50 hover:bg-slate-700 text-slate-200 rounded-xl text-[11px] font-bold transition-all border border-slate-700/50 hover:border-emerald-500/30"
            >
              <Bell className="w-3.5 h-3.5 text-emerald-400" />
              NOTIFY
            </button>
          </div>
        </div>

        {/* Toast Notification */}
        {notification && (
          <div className={cn(
            "fixed bottom-8 right-8 px-6 py-4 rounded-2xl shadow-2xl border flex items-center gap-3 animate-in slide-in-from-right-8 duration-300 z-50",
            notification.type === 'success' ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"
          )}>
            {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-sm font-bold">{notification.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
