/**
 * Live MiLB Scores — Stream Deck Plugin
 * Uses Node.js built-in modules only (net, https, crypto).
 * No npm packages required.
 */

'use strict';

const net    = require('net');
const https  = require('https');
const crypto = require('crypto');
const events = require('events');
const path   = require('path');
const fs     = require('fs');

// ── Logging ───────────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, 'plugin.log');
try { fs.writeFileSync(LOG_FILE, `=== MiLB Plugin ${new Date().toISOString()} ===\nNode: ${process.version}\nArgs: ${process.argv.slice(2).join(' ')}\n`); } catch (e) { /* ignore */ }

function log(...args) {
    const ts   = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (e) { /* ignore */ }
}

process.on('uncaughtException',  err => log('CRASH:', err.stack || err.message));
process.on('unhandledRejection', err => log('UNHANDLED:', String(err)));

// ── Parse Stream Deck launch arguments ────────────────────────────────────────
let sdPort, pluginUUID, registerEvent;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-port')          sdPort        = argv[i + 1];
    if (argv[i] === '-pluginUUID')    pluginUUID    = argv[i + 1];
    if (argv[i] === '-registerEvent') registerEvent = argv[i + 1];
}

log('port=' + sdPort + ' uuid=' + pluginUUID + ' event=' + registerEvent);

if (!sdPort || !pluginUUID || !registerEvent) {
    log('ERROR: Missing required args.');
    process.exit(1);
}

// ── Minimal WebSocket client (no external deps) ───────────────────────────────
class SimpleWS extends events.EventEmitter {
    constructor(port, host) {
        super();
        this.readyState  = 0;
        this._buf        = Buffer.alloc(0);
        this._handshaked = false;

        this._sock = net.createConnection(parseInt(port, 10), host || '127.0.0.1');

        this._sock.on('connect', () => {
            log('TCP connected, sending WS upgrade...');
            const key = crypto.randomBytes(16).toString('base64');
            this._sock.write([
                'GET / HTTP/1.1',
                `Host: 127.0.0.1:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                '', '',
            ].join('\r\n'));
        });

        this._sock.on('data',  chunk => this._onData(chunk));
        this._sock.on('error', err   => { log('TCP error:', err.message); this.emit('error', err); });
        this._sock.on('close', ()    => { this.readyState = 3; log('TCP closed'); this.emit('close'); });
    }

    _onData(chunk) {
        this._buf = Buffer.concat([this._buf, chunk]);

        if (!this._handshaked) {
            let end = -1;
            for (let i = 0; i <= this._buf.length - 4; i++) {
                if (this._buf[i]===13 && this._buf[i+1]===10 &&
                    this._buf[i+2]===13 && this._buf[i+3]===10) { end = i + 4; break; }
            }
            if (end === -1) return;

            const header = this._buf.slice(0, end).toString('ascii');
            log('HTTP response:', header.split('\r\n')[0]);

            if (!header.includes('101')) {
                log('WS upgrade failed!');
                this.emit('error', new Error('WebSocket upgrade rejected'));
                return;
            }

            this._handshaked = true;
            this.readyState  = 1;
            this._buf        = this._buf.slice(end);
            log('WS handshake OK');
            this.emit('open');
        }

        this._parseFrames();
    }

    _parseFrames() {
        while (this._buf.length >= 2) {
            const b0       = this._buf[0];
            const b1       = this._buf[1];
            const opcode   = b0 & 0x0f;
            const isMasked = !!(b1 & 0x80);
            let   plen     = b1 & 0x7f;
            let   offset   = 2;

            if (plen === 126) {
                if (this._buf.length < 4) return;
                plen = this._buf.readUInt16BE(2); offset = 4;
            } else if (plen === 127) {
                if (this._buf.length < 10) return;
                plen = Number(this._buf.readBigUInt64BE(2)); offset = 10;
            }

            const maskLen = isMasked ? 4 : 0;
            const total   = offset + maskLen + plen;
            if (this._buf.length < total) return;

            let payload = Buffer.from(this._buf.slice(offset + maskLen, total));
            if (isMasked) {
                const mask = this._buf.slice(offset, offset + 4);
                for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
            }
            this._buf = this._buf.slice(total);

            if      (opcode === 0x1) this.emit('message', payload.toString('utf8'));
            else if (opcode === 0x8) { this.readyState = 3; log('WS close frame'); this.emit('close'); return; }
            else if (opcode === 0x9) this._sendFrame(0x8a, payload); // pong — echo ping payload per RFC 6455
        }
    }

    send(str) {
        if (this.readyState !== 1) { log('WARN: send() called but WS not open (state=' + this.readyState + ')'); return; }
        this._sendFrame(0x81, Buffer.from(String(str), 'utf8'));
    }

    _sendFrame(opcode, payload) {
        const len  = payload.length;
        const mask = crypto.randomBytes(4);
        let   hdr;

        if (len < 126) {
            hdr = Buffer.alloc(6);
            hdr[0] = opcode; hdr[1] = 0x80 | len;
            mask.copy(hdr, 2);
        } else if (len < 65536) {
            hdr = Buffer.alloc(8);
            hdr[0] = opcode; hdr[1] = 0x80 | 126;
            hdr.writeUInt16BE(len, 2);
            mask.copy(hdr, 4);
        } else {
            log('WS: payload too large (' + len + ' bytes)'); return;
        }

        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
        this._sock.write(Buffer.concat([hdr, masked]));
    }
}

// ── Plugin state ──────────────────────────────────────────────────────────────
const instances     = new Map(); // context -> settings
const prevScores    = new Map(); // context -> { awayRuns, homeRuns }
const prevState     = new Map(); // context -> last known game state string
const flashing      = new Set();
const refreshing    = new Set();
const lastRender    = new Map();
const currentGame   = new Map(); // context -> { gamePk, gameDate, homeSlug, awaySlug, homeId, awayId, gameState }
const refreshTimers = new Map();

// ── Connect to Stream Deck ────────────────────────────────────────────────────
log('Connecting to Stream Deck on port', sdPort);
const ws = new SimpleWS(sdPort);

ws.on('open', () => {
    log('WS open — registering plugin');
    ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID }));
});

ws.on('message', raw => {
    let ev;
    try { ev = JSON.parse(raw); } catch (e) { log('Bad JSON:', e.message); return; }
    log('← SD event:', ev.event, ev.context ? ev.context.slice(0, 8) : '');
    try { handleEvent(ev); } catch (e) { log('handleEvent crash:', e.stack || e.message); }
});

ws.on('error', err => log('WS error:', err.message));
ws.on('close', ()  => {
    log('WS closed — exiting so Stream Deck can restart');
    setTimeout(() => process.exit(0), 2000);
});

// ── Stream Deck event handler ─────────────────────────────────────────────────
function handleEvent({ event, context, payload }) {
    switch (event) {

        case 'willAppear':
            instances.set(context, (payload && payload.settings) || {});
            log('willAppear — settings:', instances.get(context));
            if (refreshTimers.has(context)) clearInterval(refreshTimers.get(context));
            refreshTimers.set(context, setInterval(() => refreshButton(context), 30_000));
            refreshButton(context);
            break;

        case 'willDisappear':
            instances.delete(context);
            prevScores.delete(context);
            prevState.delete(context);
            lastRender.delete(context);
            currentGame.delete(context);
            refreshing.delete(context);
            if (refreshTimers.has(context)) {
                clearInterval(refreshTimers.get(context));
                refreshTimers.delete(context);
            }
            break;

        case 'didReceiveSettings':
            instances.set(context, (payload && payload.settings) || {});
            log('didReceiveSettings:', instances.get(context));
            lastRender.delete(context);
            refreshButton(context);
            break;

        case 'keyUp': {
            const cfg  = instances.get(context);
            const game = currentGame.get(context);
            if (game && game.gamePk) {
                const url = buildGameUrl(game, cfg && cfg.linkType);
                log('keyUp — opening URL:', url);
                ws.send(JSON.stringify({ event: 'openUrl', payload: { url } }));
            } else {
                log('keyUp — no game, refreshing');
                lastRender.delete(context);
                refreshButton(context);
            }
            break;
        }

        case 'sendToPlugin':
            if (payload && payload.settings) {
                instances.set(context, payload.settings);
                lastRender.delete(context);
                refreshButton(context);
            }
            break;
    }
}

// ── Refresh one button ────────────────────────────────────────────────────────
async function refreshButton(context) {
    if (refreshing.has(context)) { log('Refresh already in progress, skipping'); return; }
    if (flashing.has(context))   { log('Flash in progress, skipping refresh'); return; }

    const cfg = instances.get(context);
    if (!cfg || !cfg.teamId) {
        setButton(context, ['Select A', 'Team In', 'Settings']);
        return;
    }

    refreshing.add(context);
    log('Refreshing', cfg.teamAbbr || cfg.teamId);
    try {
        const game = await fetchTodayGame(cfg.teamId);
        currentGame.set(context, game ? {
            gamePk:    game.gamePk,
            gameDate:  game.gameDate,
            homeSlug:  game.homeSlug,
            awaySlug:  game.awaySlug,
            homeId:    game.homeId,
            awayId:    game.awayId,
            gameState: game.state,
        } : null);

        // Detect live → final transition and play fireworks
        const prevGameState = prevState.get(context);
        prevState.set(context, game ? game.state : null);
        if (prevGameState === 'live' && game && game.state === 'final') {
            const winnerIsHome = game.homeRuns >= game.awayRuns;
            const winnerName   = winnerIsHome ? game.homeName : game.awayName;
            const winnerOrgId  = winnerIsHome ? game.homeParentOrgId : game.awayParentOrgId;
            const winnerColor  = PARENT_ORG_COLOR[winnerOrgId] || '#FFD700';
            log('Game over — fireworks for', winnerName);
            refreshing.delete(context);
            playFireworks(context, winnerName, winnerColor).catch(e => log('fireworks error:', e.message));
            return;
        }

        const lines   = buildLines(game, cfg);
        const spacing = lines.some(l => typeof l === 'object') ? 1.2 : 1.4;
        log('→', JSON.stringify(lines));

        // Detect score change and flash
        const prev = prevScores.get(context);
        if (game && game.state === 'live') {
            prevScores.set(context, { awayRuns: game.awayRuns, homeRuns: game.homeRuns });
            if (prev) {
                const awayScored = game.awayRuns > prev.awayRuns;
                const homeScored = game.homeRuns > prev.homeRuns;
                if (awayScored || homeScored) {
                    // Flash in the tracked team's parent org color if they scored,
                    // or white if the opponent scored
                    const trackedId    = parseInt(cfg.teamId, 10);
                    const trackedIsAway = game.awayId === trackedId;
                    const trackedScored = trackedIsAway ? awayScored : homeScored;
                    const color = trackedScored
                        ? (PARENT_ORG_COLOR[cfg.parentOrgId] || '#FFFFFF')
                        : '#AAAAAA';
                    log('Score change — flashing', color);
                    refreshing.delete(context);
                    flashButton(context, color, lines, spacing).catch(e => log('flashButton error:', e.message));
                    return;
                }
            }
        } else {
            prevScores.delete(context);
        }

        setButton(context, lines, spacing);
    } catch (err) {
        log('Fetch error:', err.message);
        setButton(context, [cfg.teamAbbr || 'MiLB', 'Err']);
    } finally {
        refreshing.delete(context);
    }
}

// ── Build button display lines ────────────────────────────────────────────────
function buildLines(game, cfg) {
    const abbr = cfg.teamAbbr || 'MiLB';
    if (!game)                    return [abbr, 'No Game'];
    if (game.state === 'preview') return [game.matchup, game.time];
    if (game.state === 'ppd')        return [game.matchup, { text: 'PPD',   fs: 16, color: '#E74C3C' }];
    if (game.state === 'susp')       return [game.matchup, { text: 'SUSP',  fs: 16, color: '#E74C3C' }];
    if (game.state === 'delay')      return [game.matchup, { text: 'DELAY', fs: 14, color: '#3498DB' }];
    if (game.state === 'delay-live') return [
        { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
        { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
        { text: 'DELAY',                              fs: 14, color: '#3498DB' },
    ];
    if (game.state === 'live')    return [
        { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
        { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
        { text: game.half + game.inn,                fs: 14, color: '#FFD700' },
    ];
    if (game.state === 'final')   return [
        { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
        { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
        { text: 'Final',                              fs: 14, color: '#FFD700' },
    ];
    return [abbr, '---'];
}

// ── Parent org colors (MLB team IDs → primary color) ─────────────────────────
// Used to flash in the tracked team's affiliate color when they score.
const PARENT_ORG_COLOR = {
    108: '#BA0021', // LAA Angels
    109: '#A71930', // ARI Diamondbacks
    110: '#DF4601', // BAL Orioles
    111: '#BD3039', // BOS Red Sox
    112: '#0E3386', // CHC Cubs
    113: '#C6011F', // CIN Reds
    114: '#E31937', // CLE Guardians
    115: '#33006F', // COL Rockies
    116: '#FA4616', // DET Tigers
    117: '#EB6E1F', // HOU Astros
    118: '#004687', // KC  Royals
    119: '#005A9C', // LAD Dodgers
    120: '#AB0003', // WSH Nationals
    121: '#002D72', // NYM Mets
    133: '#006B3F', // ATH Athletics
    134: '#FDB827', // PIT Pirates
    135: '#FFC425', // SD  Padres
    136: '#005C5C', // SEA Mariners
    137: '#FD5A1E', // SF  Giants
    138: '#C41E3A', // STL Cardinals
    139: '#F5D130', // TB  Rays
    140: '#C0111F', // TEX Rangers
    141: '#134A8E', // TOR Blue Jays
    142: '#D31145', // MIN Twins
    143: '#E81828', // PHI Phillies
    144: '#CE1141', // ATL Braves
    145: '#C4CED4', // CWS White Sox
    146: '#00A3E0', // MIA Marlins
    147: '#C4CED4', // NYY Yankees
    158: '#FFC52F', // MIL Brewers
};

// ── URL building ──────────────────────────────────────────────────────────────
function buildGameUrl(game, linkType) {
    if (!game || !game.gamePk) return 'https://www.milb.com';
    if (linkType === 'tv') {
        return `https://www.milb.com/live-stream-games/g${game.gamePk}`;
    }
    // Gameday URL — suffix matches game state
    const suffix = game.gameState === 'live'  ? 'live'
                 : game.gameState === 'final' ? 'final'
                 : 'preview';
    const away = game.awaySlug || 'away';
    const home = game.homeSlug || 'home';
    return `https://www.milb.com/gameday/${away}-vs-${home}/${game.gameDate}/${game.gamePk}/${suffix}`;
}

// ── MLB Stats API ─────────────────────────────────────────────────────────────
function fetchTodayGame(teamId) {
    return new Promise((resolve, reject) => {
        const now  = new Date();
        // Don't roll to the next day's schedule until 2am — covers late-running games
        if (now.getHours() < 2) now.setDate(now.getDate() - 1);
        const date = now.getFullYear() + '-' +
                     String(now.getMonth() + 1).padStart(2, '0') + '-' +
                     String(now.getDate()).padStart(2, '0');
        // sportId=11,12,13,14 covers Triple-A, Double-A, High-A, Single-A
        const url = 'https://statsapi.mlb.com/api/v1/schedule' +
                    '?sportId=11,12,13,14&date=' + date +
                    '&teamId=' + teamId +
                    '&hydrate=linescore,team';

        const req = https.get(url, { headers: { 'User-Agent': 'StreamDeckMiLBScores/1.0' } }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(parseSchedule(JSON.parse(body))); }
                catch (e) { reject(e); }
            });
        });

        req.on('error', reject);
        req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Request timed out')); });
    });
}

// Convert a MiLB teamName (mascot only, e.g. "Jumbo Shrimp") to a URL slug
function toSlug(name) {
    return (name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function parseSchedule(data) {
    try {
        if (!data?.dates?.length) { log('API: no dates (off day)'); return null; }

        const games = data.dates[0].games;
        if (!games?.length) { log('API: no games'); return null; }

        const g      = games[0];
        const status   = g?.status?.abstractGameState;
        const detailed = g?.status?.detailedState || '';
        if (!status) { log('API: missing status'); return null; }

        const homeId = g?.teams?.home?.team?.id;
        const awayId = g?.teams?.away?.team?.id;
        if (!homeId || !awayId) { log('API: missing team IDs'); return null; }

        // Abbreviations, names, slugs, and parent org IDs from hydrated team data
        const homeAbbr        = g?.teams?.home?.team?.abbreviation || 'HME';
        const awayAbbr        = g?.teams?.away?.team?.abbreviation || 'AWY';
        const homeName        = g?.teams?.home?.team?.teamName || homeAbbr;
        const awayName        = g?.teams?.away?.team?.teamName || awayAbbr;
        const homeSlug        = toSlug(g?.teams?.home?.team?.teamName);
        const awaySlug        = toSlug(g?.teams?.away?.team?.teamName);
        const homeParentOrgId = g?.teams?.home?.team?.parentOrgId || g?.teams?.home?.team?.parentTeamId;
        const awayParentOrgId = g?.teams?.away?.team?.parentOrgId || g?.teams?.away?.team?.parentTeamId;
        const matchup     = awayAbbr + ' @ ' + homeAbbr;
        const gamePk      = g.gamePk;
        const gameDate    = g.gameDate ? g.gameDate.slice(0, 10).replace(/-/g, '/') : '2000/01/01';
        const ls          = g.linescore;

        log('API:', status, detailed, matchup, 'pk=' + gamePk);

        // Special states — check detailedState first so they override abstractGameState
        if (detailed.startsWith('Postponed'))         return { state: 'ppd',   matchup, gamePk, gameDate };
        if (detailed.startsWith('Suspended'))         return { state: 'susp',  matchup, gamePk, gameDate };
        if (detailed.toLowerCase().includes('delay')) {
            // Mid-game delay: game started, show score with DELAY where inning would be
            const inn = ls?.currentInning;
            if (inn) {
                const homeRuns = ls?.teams?.home?.runs ?? 0;
                const awayRuns = ls?.teams?.away?.runs ?? 0;
                return { state: 'delay-live', matchup, homeAbbr, awayAbbr, homeId, awayId, homeRuns, awayRuns, gamePk, gameDate, homeName, awayName, homeParentOrgId, awayParentOrgId };
            }
            return { state: 'delay', matchup, gamePk, gameDate };
        }

        if (status === 'Preview') {
            return { state: 'preview', matchup, time: fmtTime(g.gameDate), gamePk, gameDate, homeSlug, awaySlug, homeId, awayId, homeName, awayName, homeParentOrgId, awayParentOrgId };
        }

        const homeRuns = ls?.teams?.home?.runs ?? 0;
        const awayRuns = ls?.teams?.away?.runs ?? 0;

        if (status === 'Final') {
            return { state: 'final', matchup, homeAbbr, awayAbbr, homeSlug, awaySlug, homeId, awayId, homeRuns, awayRuns, gamePk, gameDate, homeName, awayName, homeParentOrgId, awayParentOrgId };
        }

        // Live
        const inn  = ls?.currentInning || '?';
        const half = ls?.inningHalf === 'Top' ? '\u25b2' : '\u25bc';

        return { state: 'live', matchup, homeAbbr, awayAbbr, homeSlug, awaySlug, homeId, awayId, homeRuns, awayRuns, inn, half, gamePk, gameDate, homeName, awayName, homeParentOrgId, awayParentOrgId };

    } catch (e) {
        log('parseSchedule error:', e.message);
        return null;
    }
}

function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return '?:??'; }
}

// ── SVG button renderer ───────────────────────────────────────────────────────
function escXml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function makeImage(lines, lineSpacing = 1.4, bgColor = 'black') {
    const W = 72, H = 72, PAD = 4, MAX_W = W - PAD * 2;

    const items = lines.map(l => {
        if (typeof l === 'string') {
            let fs = 16;
            while (fs > 8 && l.length * fs * 0.60 > MAX_W) fs--;
            return { text: l, fs };
        }
        return l;
    });

    const lineHeights = items.map(({ fs }) => fs * lineSpacing);
    const totalH      = lineHeights.reduce((a, b) => a + b, 0);
    let   y           = (H - totalH) / 2 + items[0].fs * 0.80;

    const rows = items.map(({ text, fs, color }, i) => {
        if (i > 0) y += lineHeights[i - 1] - items[i - 1].fs * 0.80 + fs * 0.80;
        return `<text x="36" y="${y.toFixed(1)}" text-anchor="middle" fill="${color || 'white'}" ` +
               `font-family="Helvetica Neue,Arial,sans-serif" font-size="${fs}" font-weight="600">${escXml(text)}</text>`;
    }).join('');

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="144" height="144" overflow="hidden">` +
        `<rect width="${W}" height="${H}" fill="${bgColor}"/>` +
        rows + `</svg>`;

    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function makeFireworks(frame, winnerColor, winnerName) {
    const W = 72, H = 72;
    const cx = 36, cy = 36;
    const COLORS = [winnerColor, '#FFD700', '#FFFFFF'];

    let circles = '';
    [0, 4, 8, 12, 16, 20, 24, 28, 32, 36].forEach((startFrame, burstIdx) => {
        const f = frame - startFrame;
        if (f < 0 || f >= 6) return;
        const progress = f / 5;
        const r        = 5 + progress * 28;
        const pSize    = Math.max(0.5, 3.5 - progress * 2.5);
        const opacity  = (1 - progress * 0.65).toFixed(2);
        for (let i = 0; i < 8; i++) {
            const angle = (i * 45 + burstIdx * 22.5) * Math.PI / 180;
            const px    = (cx + r * Math.cos(angle)).toFixed(1);
            const py    = (cy + r * Math.sin(angle)).toFixed(1);
            const color = COLORS[(i + burstIdx) % COLORS.length];
            circles += `<circle cx="${px}" cy="${py}" r="${pSize.toFixed(1)}" fill="${color}" opacity="${opacity}"/>`;
        }
    });

    const throb   = Math.floor(frame / 2) % 2 === 0;
    const winSize = throb ? 20 : 16;
    let nameSize = 13;
    while (nameSize > 7 && winnerName.length * nameSize * 0.62 > 62) nameSize--;
    const nameY = throb ? 25 : 27;

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="144" height="144" overflow="hidden">` +
        `<rect width="${W}" height="${H}" fill="black"/>` +
        circles +
        `<text x="36" y="${nameY}" text-anchor="middle" fill="white" ` +
        `font-family="Helvetica Neue,Arial,sans-serif" font-size="${nameSize}" font-weight="700">${escXml(winnerName)}</text>` +
        `<text x="36" y="50" text-anchor="middle" fill="#FFD700" ` +
        `font-family="Helvetica Neue,Arial,sans-serif" font-size="${winSize}" font-weight="800">WIN!</text>` +
        `</svg>`;

    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function playFireworks(context, winnerName, winnerColor) {
    if (flashing.has(context)) return;
    flashing.add(context);
    log('→ fireworks for', winnerName, winnerColor);
    try {
        for (let i = 0; i < 42; i++) {
            const img = makeFireworks(i, winnerColor, winnerName);
            ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: img, target: 0 } }));
            await sleep(120);
        }
    } finally {
        flashing.delete(context);
        lastRender.delete(context);
        refreshButton(context);
    }
}

function setButton(context, lines, lineSpacing, bgColor) {
    const key = JSON.stringify(lines);
    if (!bgColor && lastRender.get(context) === key) return;
    if (!bgColor) lastRender.set(context, key);
    ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: makeImage(lines, lineSpacing, bgColor), target: 0 } }));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function flashButton(context, color, lines, spacing) {
    if (flashing.has(context)) return;
    flashing.add(context);
    log('→ flash', color);
    try {
        for (let i = 0; i < 4; i++) {
            setButton(context, lines, spacing, color);
            await sleep(200);
            setButton(context, lines, spacing, 'black');
            await sleep(200);
        }
    } finally {
        flashing.delete(context);
        setButton(context, lines, spacing, 'black');
    }
}
