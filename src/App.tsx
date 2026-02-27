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
  Layers
} from 'lucide-react';
import { format } from 'date-fns';
import Markdown from 'react-markdown';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { cn } from './lib/utils';
import { Incident, Log, AgentStep, Deployment } from './types';
import { tools, searchLogs, runESQL, getDeployments, model } from './lib/gemini';

export default function App() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchIncidents();
    fetchDeployments();
  }, []);

  useEffect(() => {
    if (stepsEndRef.current) {
      stepsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [agentSteps]);

  const fetchIncidents = async () => {
    try {
      const res = await fetch('/api/incidents');
      const data = await res.json();
      setIncidents(data);
    } catch (e) {
      console.error("Failed to fetch incidents", e);
    }
  };

  const fetchDeployments = async () => {
    try {
      const data = await getDeployments();
      setDeployments(data);
    } catch (e) {
      console.error("Failed to fetch deployments", e);
    }
  };

  const runInvestigation = async (incident: Incident) => {
    setIsInvestigating(true);
    setAgentSteps([]);
    setLogs([]);
    
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    const chat = ai.chats.create({
      model: model,
      config: {
        systemInstruction: `You are LogSage, an autonomous DevOps incident investigation agent. 
        Your goal is to investigate the provided incident by using tools to search logs, run ES|QL analytics, and check deployments.
        
        Follow this reasoning flow:
        1. Analyze the incident description.
        2. Retrieve relevant logs for the affected service around the incident time.
        3. Run ES|QL pattern analysis to find spikes or common error patterns.
        4. Check recent deployments for correlation.
        5. Identify the probable root cause and provide evidence.
        6. Recommend a fix.
        
        Always explain your thoughts before calling a tool.
        When you have a final conclusion, output a "Incident Investigation Report" in Markdown format.`,
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

      while (!finished && iterations < 10) {
        iterations++;
        const response: GenerateContentResponse = await chat.sendMessage({ message });
        
        // Handle thoughts
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
              content: `Calling ${call.name} with ${JSON.stringify(call.args)}`,
              timestamp: new Date().toISOString(),
              metadata: call
            }]);

            let result;
            if (call.name === 'search_logs') {
              result = await searchLogs(call.args as any);
              if (Array.isArray(result)) setLogs(result);
            } else if (call.name === 'run_esql_analytics') {
              result = await runESQL(call.args as any);
            } else if (call.name === 'get_deployments') {
              result = await getDeployments();
            }

            setAgentSteps(prev => [...prev, {
              type: 'tool_result',
              content: `Result from ${call.name}: ${Array.isArray(result) ? result.length : '1'} items found.`,
              timestamp: new Date().toISOString(),
              metadata: result
            }]);

            toolResults.push({
              name: call.name,
              response: { result },
              id: call.id
            });
          }

          // Send tool results back to model
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
          
          // Check if the model is done after tool results
          if (toolResponse.text?.includes("Incident Investigation Report")) {
            finished = true;
          }
          
          // Prepare next iteration message if not finished
          message = "Continue investigation based on these results.";
        } else {
          finished = true;
        }
      }
    } catch (error: any) {
      console.error("Investigation failed", error);
      setAgentSteps(prev => [...prev, {
        type: 'thought',
        content: `Error during investigation: ${error.message}`,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsInvestigating(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#0D0E12] text-slate-300 font-sans selection:bg-indigo-500/30">
      {/* Left Panel: Incidents */}
      <div className="w-80 border-r border-slate-800 flex flex-col bg-[#15161A]">
        <div className="p-4 border-bottom border-slate-800 flex items-center gap-2">
          <Activity className="text-indigo-500 w-5 h-5" />
          <h1 className="font-bold text-slate-100 tracking-tight">LogSage</h1>
          <span className="ml-auto text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 font-mono">v1.0.0</span>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Active Incidents</div>
          {incidents.map(inc => (
            <button
              key={inc.id}
              onClick={() => {
                setSelectedIncident(inc);
                if (!isInvestigating) runInvestigation(inc);
              }}
              className={cn(
                "w-full text-left p-4 border-b border-slate-800/50 transition-all hover:bg-slate-800/30 group",
                selectedIncident?.id === inc.id ? "bg-indigo-500/10 border-l-2 border-l-indigo-500" : ""
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded",
                  inc.severity === 'CRITICAL' ? "bg-red-500/20 text-red-400" : 
                  inc.severity === 'HIGH' ? "bg-orange-500/20 text-orange-400" : "bg-blue-500/20 text-blue-400"
                )}>
                  {inc.severity}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">{format(new Date(inc.timestamp), 'HH:mm')}</span>
              </div>
              <div className="font-medium text-slate-200 text-sm group-hover:text-indigo-400 transition-colors">{inc.title}</div>
              <div className="text-xs text-slate-500 mt-1 truncate">{inc.service}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Center Panel: Investigation */}
      <div className="flex-1 flex flex-col bg-[#0D0E12] relative">
        <div className="h-14 border-b border-slate-800 flex items-center px-6 justify-between bg-[#15161A]/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Cpu className={cn("w-5 h-5", isInvestigating ? "text-indigo-400 animate-pulse" : "text-slate-500")} />
            <h2 className="text-sm font-semibold text-slate-100">Agent Reasoning</h2>
          </div>
          {isInvestigating && (
            <div className="flex items-center gap-2 text-[10px] text-indigo-400 font-mono">
              <RefreshCcw className="w-3 h-3 animate-spin" />
              ANALYZING SYSTEM STATE...
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!selectedIncident ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600">
              <Terminal className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm">Select an incident to begin investigation</p>
            </div>
          ) : (
            <>
              <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Incident Context</span>
                </div>
                <h3 className="text-lg font-bold text-slate-100 mb-1">{selectedIncident.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{selectedIncident.description}</p>
              </div>

              <div className="space-y-4">
                {agentSteps.map((step, i) => (
                  <div key={i} className={cn(
                    "flex gap-4 group",
                    step.type === 'thought' ? "opacity-100" : "opacity-80"
                  )}>
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center border",
                        step.type === 'thought' ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-400" :
                        step.type === 'tool_call' ? "bg-amber-500/20 border-amber-500/50 text-amber-400" :
                        "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                      )}>
                        {step.type === 'thought' ? <Cpu className="w-4 h-4" /> : 
                         step.type === 'tool_call' ? <Database className="w-4 h-4" /> : 
                         <CheckCircle2 className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 w-px bg-slate-800 my-2 group-last:hidden" />
                    </div>
                    <div className="flex-1 pb-6">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                          {step.type === 'thought' ? 'Agent Reasoning' : 
                           step.type === 'tool_call' ? 'Executing Tool' : 'Tool Result'}
                        </span>
                        <span className="text-[10px] text-slate-700 font-mono">{format(new Date(step.timestamp), 'HH:mm:ss.SSS')}</span>
                      </div>
                      <div className={cn(
                        "text-sm leading-relaxed",
                        step.type === 'thought' ? "text-slate-300" : "text-slate-500 font-mono text-[11px]"
                      )}>
                        {step.type === 'thought' ? (
                          <div className="markdown-body prose prose-invert prose-sm max-w-none">
                            <Markdown>{step.content}</Markdown>
                          </div>
                        ) : step.content}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={stepsEndRef} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right Panel: Logs & Actions */}
      <div className="w-96 border-l border-slate-800 flex flex-col bg-[#15161A]">
        <div className="h-14 border-b border-slate-800 flex items-center px-4 gap-4 bg-[#15161A]">
          <button className="text-xs font-bold text-slate-100 border-b-2 border-indigo-500 pb-4 mt-4">Evidence Logs</button>
          <button className="text-xs font-bold text-slate-500 pb-4 mt-4 hover:text-slate-300 transition-colors">Metrics</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-700 opacity-50">
              <Layers className="w-8 h-8 mb-2" />
              <p className="text-[10px] uppercase tracking-widest font-bold">No logs retrieved</p>
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="p-3 bg-slate-900/50 border border-slate-800 rounded font-mono text-[10px] hover:border-slate-700 transition-colors">
                <div className="flex justify-between mb-1">
                  <span className={cn(
                    "px-1 rounded",
                    log.severity === 'ERROR' ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                  )}>{log.severity}</span>
                  <span className="text-slate-600">{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
                </div>
                <div className="text-slate-300 break-all">{log.message}</div>
                {log.error_type && <div className="text-indigo-400 mt-1">type: {log.error_type}</div>}
                <div className="text-slate-600 mt-1">v{log.version} | {log.trace_id}</div>
              </div>
            ))
          )}
        </div>

        {/* Action Panel */}
        <div className="p-4 border-t border-slate-800 bg-[#0D0E12]">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Recommended Actions</div>
          <div className="grid grid-cols-2 gap-2">
            <button className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium transition-colors">
              <RefreshCcw className="w-3 h-3 text-indigo-400" />
              Restart Service
            </button>
            <button className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium transition-colors">
              <History className="w-3 h-3 text-orange-400" />
              Rollback v2.3.1
            </button>
            <button className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium transition-colors">
              <Ticket className="w-3 h-3 text-blue-400" />
              Create Ticket
            </button>
            <button className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium transition-colors">
              <Bell className="w-3 h-3 text-emerald-400" />
              Notify Slack
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
