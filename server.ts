import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("logsage.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    service TEXT,
    severity TEXT,
    status TEXT,
    title TEXT,
    description TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    service TEXT,
    severity TEXT,
    error_type TEXT,
    message TEXT,
    version TEXT,
    trace_id TEXT
  );

  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    service TEXT,
    metric_name TEXT,
    value REAL
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    service TEXT,
    version TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT
  );
`);

// Mock Data Generator
function seedData() {
  const incidentCount = db.prepare("SELECT COUNT(*) as count FROM incidents").get() as { count: number };
  if (incidentCount.count > 0) return;

  console.log("Seeding mock data...");

  // Deployments
  const insertDeployment = db.prepare("INSERT INTO deployments (id, service, version, status, timestamp) VALUES (?, ?, ?, ?, ?)");
  insertDeployment.run("dep-1", "payments-api", "2.3.0", "success", "2026-02-26T10:00:00Z");
  insertDeployment.run("dep-2", "payments-api", "2.3.1", "success", "2026-02-26T18:00:00Z");
  insertDeployment.run("dep-3", "auth-service", "1.1.0", "success", "2026-02-26T09:00:00Z");

  // Logs
  const insertLog = db.prepare("INSERT INTO logs (service, severity, error_type, message, version, timestamp, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
  
  // Normal logs
  for (let i = 0; i < 50; i++) {
    insertLog.run("payments-api", "INFO", null, "Request processed successfully", "2.3.0", `2026-02-26T10:${String(i).padStart(2, '0')}:00Z`, `trace-${i}`);
  }

  // Error logs for incident
  for (let i = 0; i < 20; i++) {
    insertLog.run("payments-api", "ERROR", "MemoryLeak", "OutOfMemoryError: Java heap space", "2.3.1", `2026-02-26T19:${String(i).padStart(2, '0')}:00Z`, `trace-err-${i}`);
    insertLog.run("payments-api", "WARN", "GC_Pressure", "High GC overhead detected", "2.3.1", `2026-02-26T19:${String(i).padStart(2, '0')}:05Z`, `trace-err-${i}`);
  }

  // Incidents
  const insertIncident = db.prepare("INSERT INTO incidents (id, service, severity, status, title, description, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insertIncident.run("inc-101", "payments-api", "CRITICAL", "OPEN", "High Error Rate in Payments API", "Spike in OOM errors detected after recent deployment.", "2026-02-26T19:15:00Z");
  insertIncident.run("inc-102", "auth-service", "MEDIUM", "RESOLVED", "Latence Spike", "Authentication requests taking > 500ms", "2026-02-26T14:20:00Z");

  console.log("Seeding complete.");
}

seedData();

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get("/api/incidents", (req, res) => {
    const incidents = db.prepare("SELECT * FROM incidents ORDER BY timestamp DESC").all();
    res.json(incidents);
  });

  app.get("/api/incidents/:id", (req, res) => {
    const incident = db.prepare("SELECT * FROM incidents WHERE id = ?").get(req.params.id);
    res.json(incident);
  });

  app.get("/api/logs", (req, res) => {
    const { service, start, end, limit = 100 } = req.query;
    let query = "SELECT * FROM logs WHERE 1=1";
    const params = [];

    if (service) {
      query += " AND service = ?";
      params.push(service);
    }
    if (start) {
      query += " AND timestamp >= ?";
      params.push(start);
    }
    if (end) {
      query += " AND timestamp <= ?";
      params.push(end);
    }

    query += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);

    const logs = db.prepare(query).all(...params);
    res.json(logs);
  });

  app.post("/api/query", (req, res) => {
    const { sql } = req.body;
    try {
      // Basic safety check for mock ES|QL (which is SQL here)
      if (!sql.toLowerCase().startsWith("select")) {
        return res.status(400).json({ error: "Only SELECT queries allowed" });
      }
      const results = db.prepare(sql).all();
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/deployments", (req, res) => {
    const deployments = db.prepare("SELECT * FROM deployments ORDER BY timestamp DESC").all();
    res.json(deployments);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
