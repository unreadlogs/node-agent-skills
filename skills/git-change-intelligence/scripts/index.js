#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import git from 'isomorphic-git';

function fail(message) { process.stderr.write(JSON.stringify({ error: message }) + '\n'); process.exitCode = 1; }
function parseArgs(values) { const positional = []; const flags = {}; for (let i = 0; i < values.length; i += 1) { if (!values[i].startsWith('--')) positional.push(values[i]); else if (values[i + 1] && !values[i + 1].startsWith('--')) flags[values[i].slice(2)] = values[++i]; else flags[values[i].slice(2)] = true; } return { positional, flags }; }
async function main() { const [command, ...rest] = process.argv.slice(2); const { positional, flags } = parseArgs(rest); const dir = path.resolve(positional[0] || '.'); if (!['status', 'commits', 'diff'].includes(command)) throw new Error('usage: index.js <status|commits|diff> <repo>'); const fsApi = fs; if (command === 'status' || command === 'diff') { const matrix = await git.statusMatrix({ fs: fsApi, dir }); const files = matrix.map(([file, head, worktree, stage]) => ({ file, head, worktree, stage, state: head === 0 ? 'untracked' : worktree === 0 ? 'deleted' : stage !== head ? 'staged' : worktree !== head ? 'modified' : 'clean' })).filter((file) => command === 'diff' ? file.state !== 'clean' : true); process.stdout.write(JSON.stringify({ data: { repo: dir, files } }) + '\n'); } else { const commits = await git.log({ fs: fsApi, dir, depth: Math.min(100, Math.max(1, Number(flags.limit ?? 10))) }); process.stdout.write(JSON.stringify({ data: { repo: dir, commits: commits.map(({ commit, oid }) => ({ oid, message: commit.message.trim(), author: commit.author, committer: commit.committer })) } }) + '\n'); } }
main().catch((error) => fail(error.message));
