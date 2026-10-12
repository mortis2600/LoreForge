// Background job runner for long ingest operations. Spawns the ingest CLI
// as a child process, streams its output to a per-job log file, and tracks
// state in memory. Job history is lost on server restart by design; the log
// files in ./logs survive.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const jobs = new Map();

function logPath(id, sourceKey) {
    fs.mkdirSync('./logs', { recursive: true });
    return path.resolve(`./logs/ingest-${sourceKey}-${id}.log`);
}

export function startIngestJob(sourceKey, entityType = null) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const logFile = logPath(id, sourceKey);
    const args = ['src/services/ingest.js', sourceKey];
    if (entityType) args.push(entityType);

    const child = spawn('node', args, { cwd: process.cwd() });
    const job = {
        id,
        kind: 'ingest',
        source: sourceKey,
        entityType,
        status: 'running',
        pid: child.pid,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        logFile
    };

    const log = fs.createWriteStream(logFile);
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on('error', err => {
        job.status = 'error';
        job.finishedAt = new Date().toISOString();
        fs.appendFileSync(logFile, `\n[spawn error: ${err.message}]\n`);
        log.end();
    });
    child.on('close', code => {
        job.status = code === 0 ? 'done' : 'error';
        job.exitCode = code;
        job.finishedAt = new Date().toISOString();
        log.end();
    });

    jobs.set(id, job);
    return job;
}

export function startTriviaJob(sourceKey, count = 100) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const logFile = logPath(id, `${sourceKey}-trivia`);
    const child = spawn('node', ['src/services/trivia-generator.js', sourceKey, String(count)], {
        cwd: process.cwd()
    });
    const job = {
        id,
        kind: 'trivia',
        source: sourceKey,
        entityType: null,
        status: 'running',
        pid: child.pid,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        logFile
    };
    const log = fs.createWriteStream(logFile);
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.on('error', err => {
        job.status = 'error';
        job.finishedAt = new Date().toISOString();
        fs.appendFileSync(logFile, `\n[spawn error: ${err.message}]\n`);
        log.end();
    });
    child.on('close', code => {
        job.status = code === 0 ? 'done' : 'error';
        job.exitCode = code;
        job.finishedAt = new Date().toISOString();
        log.end();
    });
    jobs.set(id, job);
    return job;
}

export function listJobs() {
    return [...jobs.values()]
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
        .map(({ logFile, ...rest }) => rest);
}

export function getJob(id) {
    const job = jobs.get(id);
    if (!job) return null;
    const { logFile, ...rest } = job;
    return { ...rest, log: readLogTail(logFile, 200) };
}

function readLogTail(logFile, lines) {
    try {
        const content = fs.readFileSync(logFile, 'utf8');
        return content.split('\n').slice(-lines).join('\n');
    } catch {
        return '';
    }
}
