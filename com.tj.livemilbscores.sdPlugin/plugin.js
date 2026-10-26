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

// plugin.log is only reset when the plugin starts, so on a deck that stays up
// for days it would otherwise grow without limit (every poll logs a few lines).
// Past LOG_MAX_BYTES it is truncated and starts over.
const LOG_MAX_BYTES = 512 * 1024;
let   logBytes      = 0;

function log(...args) {
    const ts   = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
    try {
        if (logBytes > LOG_MAX_BYTES) { fs.writeFileSync(LOG_FILE, `=== log trimmed ${new Date().toISOString()} ===\n`); logBytes = 0; }
        fs.appendFileSync(LOG_FILE, line);
        logBytes += line.length;
    } catch (e) { /* ignore */ }
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
const refreshTimers    = new Map();

// ── Doubleheader double-click toggle ──────────────────────────────────────────
const gameFinalAt       = new Map(); // context -> timestamp when live→final was detected
const dhOtherGame       = new Map(); // context -> parsed other-game object | null
const dhViewOther       = new Map(); // context -> true while user is viewing the other game
const dhRevertTimers    = new Map(); // context -> timeoutId for auto-revert
const lastKeyUpTime     = new Map(); // context -> timestamp of last keyUp (double-click detection)
const singleClickTimers = new Map(); // context -> timeoutId for pending single-click
const DOUBLE_CLICK_MS   = 300;       // two taps within this window = double-click
const DH_REVERT_MS      = 15_000;    // auto-revert to active game after 15 s

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
            gameFinalAt.delete(context);
            dhOtherGame.delete(context);
            dhViewOther.delete(context);
            clearTimeout(dhRevertTimers.get(context));
            dhRevertTimers.delete(context);
            clearTimeout(singleClickTimers.get(context));
            singleClickTimers.delete(context);
            lastKeyUpTime.delete(context);
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
            const cfg       = instances.get(context);
            const game      = currentGame.get(context);
            const otherGame = dhOtherGame.get(context);
            const now       = Date.now();
            const last      = lastKeyUpTime.get(context) || 0;
            lastKeyUpTime.set(context, now);

            if (otherGame && now - last < DOUBLE_CLICK_MS) {
                // ── Double-click on a doubleheader: toggle other-game view ──
                clearTimeout(singleClickTimers.get(context));
                singleClickTimers.delete(context);
                const goingToOther = !dhViewOther.get(context);
                clearTimeout(dhRevertTimers.get(context));
                if (goingToOther) {
                    dhViewOther.set(context, true);
                    log('DH double-click — showing other game');
                    dhRevertTimers.set(context, setTimeout(() => {
                        dhViewOther.delete(context);
                        dhRevertTimers.delete(context);
                        lastRender.delete(context);
                        refreshButton(context);
                    }, DH_REVERT_MS));
                } else {
                    dhViewOther.delete(context);
                    dhRevertTimers.delete(context);
                    log('DH double-click — back to active game');
                }
                lastRender.delete(context);
                const lines   = dhViewOther.get(context) ? buildOtherLines(otherGame) : buildLines(game, cfg);
                const spacing = lines.spacing || (lines.some(l => typeof l === 'object') ? 1.2 : 1.4);
                setButton(context, lines, spacing, resolveBgColor(cfg));

            } else if (otherGame) {
                // ── Single-click on a doubleheader: wait briefly for possible double-click ──
                clearTimeout(singleClickTimers.get(context));
                singleClickTimers.set(context, setTimeout(() => {
                    singleClickTimers.delete(context);
                    // If the user is viewing the other game, open that game's page
                    const target = (dhViewOther.get(context) && otherGame) ? otherGame : game;
                    if (target && target.gamePk) {
                        const cfgLink = cfg && cfg.linkType;
                        let effectiveLink = cfgLink;
                        if ((cfgLink === 'tv' || cfgLink === 'custom') && target.state === 'final') {
                            const isActive = target === game;
                            const ft = isActive ? gameFinalAt.get(context) : null;
                            if (!ft || Date.now() - ft > 30 * 60 * 1000) effectiveLink = 'gameday';
                        }
                        openGameUrl(target, effectiveLink, cfg, 'DH keyUp (single)');
                    } else {
                        log('DH keyUp (single) — no game, refreshing');
                        lastRender.delete(context);
                        refreshButton(context);
                    }
                }, DOUBLE_CLICK_MS + 50));

            } else {
                // ── Non-doubleheader: fire immediately ──
                if (game && game.gamePk) {
                    const cfgLink = cfg && cfg.linkType;
                    let effectiveLink = cfgLink;
                    if ((cfgLink === 'tv' || cfgLink === 'custom') && game.state === 'final') {
                        const ft = gameFinalAt.get(context);
                        if (!ft || Date.now() - ft > 30 * 60 * 1000) effectiveLink = 'gameday';
                    }
                    openGameUrl(game, effectiveLink, cfg, 'keyUp');
                } else {
                    log('keyUp — no game, refreshing');
                    lastRender.delete(context);
                    refreshButton(context);
                }
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
        // The key may have left the screen while the request was in flight;
        // presenting now would re-create its per-key memory for nothing.
        if (!instances.has(context)) return;
        currentGame.set(context, game || null);
        dhOtherGame.set(context, game?.otherGame || null);
        if (!game || game.state !== 'final') gameFinalAt.delete(context);

        // Detect live → final transition and play fireworks
        const prevGameState = prevState.get(context);
        prevState.set(context, game ? game.state : null);
        if (prevGameState === 'live' && game && game.state === 'final') {
            const winnerIsHome = game.homeRuns >= game.awayRuns;
            const winnerName   = winnerIsHome ? game.homeName : game.awayName;
            const winnerOrgId  = winnerIsHome ? game.homeParentOrgId : game.awayParentOrgId;
            const winnerColor  = PARENT_ORG_COLOR[winnerOrgId] || '#FFD700';
            log('Game over — fireworks for', winnerName);
            gameFinalAt.set(context, Date.now());
            dhViewOther.delete(context);
            clearTimeout(dhRevertTimers.get(context));
            dhRevertTimers.delete(context);
            refreshing.delete(context);
            playFireworks(context, winnerName, winnerColor).catch(e => log('fireworks error:', e.message));
            return;
        }

        const viewing  = dhViewOther.get(context) && game?.otherGame;
        const lines    = viewing ? buildOtherLines(game.otherGame) : buildLines(game, cfg);
        const spacing  = lines.spacing || (lines.some(l => typeof l === 'object') ? 1.2 : 1.4);
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
                    // Runs card (one team only — both teams scoring between polls
                    // only happens after missed polls, so that just flashes)
                    const card = (awayScored && homeScored) ? null
                        : awayScored ? runsCardLines(game.awayAbbr, game.awayRuns - prev.awayRuns)
                                     : runsCardLines(game.homeAbbr, game.homeRuns - prev.homeRuns);
                    log('Score change — flashing', color);
                    dhViewOther.delete(context);
                    clearTimeout(dhRevertTimers.get(context));
                    dhRevertTimers.delete(context);
                    refreshing.delete(context);
                    flashButton(context, color, lines, spacing, resolveBgColor(cfg), card).catch(e => log('flashButton error:', e.message));
                    return;
                }
            }
        } else {
            prevScores.delete(context);
        }

        setButton(context, lines, spacing, resolveBgColor(cfg));
    } catch (err) {
        log('Fetch error:', err.message);
        setButton(context, [cfg.teamAbbr || 'MiLB', 'Err'], undefined, resolveBgColor(cfg));
    } finally {
        refreshing.delete(context);
    }
}

// ── Live inning row: out dots (SVG circles) + inning indicator ────────────────
function liveInnLine(outs, innText) {
    const n = outs ?? 0;
    return {
        dotFill1: n >= 1 ? '#E74C3C' : '#555555',
        dotFill2: n >= 2 ? '#E74C3C' : '#555555',
        innText,
        innFs: innText.trim().length > 3 ? 11 : 14,
        fs: 14,
    };
}

// ── Build button display lines ────────────────────────────────────────────────
function buildLines(game, cfg) {
    const abbr = cfg.teamAbbr || 'MiLB';
    if (!game) return [abbr, 'No Game'];

    // Upcoming games (today, or the next one on an off day): stacked layout —
    // away / @ home / day / time, same as the NFL, CFB, NHL and NBA plugins.
    if (game.state === 'nextgame') return baseballPregameLines(game);

    const gl = game.gameLabel ? ' ' + game.gameLabel : '';

    if (game.state === 'preview') return baseballPregameLines(game);
    if (game.state === 'ppd')     return baseballPregameLines(game, { text: (game.canceled ? 'CANC' : 'PPD') + gl, fs: 14, color: '#E74C3C' });
    if (game.state === 'susp')    return baseballPregameLines(game, { text: 'SUSP' + gl, fs: 14, color: '#E74C3C' });
    // Pre-game rain delay / warmup: the start time, then the status underneath
    if (game.state === 'delay')   return baseballPregameLines(game, w => [{ text: w.time, fs: PRE_TIME_FS }, { text: 'DELAY' + gl, fs: PRE_TIME_FS, color: '#3498DB' }]);
    if (game.state === 'warmup')  return baseballPregameLines(game, w => [{ text: w.time, fs: PRE_TIME_FS }, { text: 'WARMUP' + gl, fs: PRE_TIME_FS, color: '#2ECC71' }]);
    if (game.state === 'delay-live') return [
        { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
        { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
        { text: 'DELAY' + gl,                         fs: gl ? 13 : 14, color: '#3498DB' },
    ];
    if (game.state === 'live') return [
        { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
        { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
        liveInnLine(game.outs, game.half + game.inn + gl),
    ];
    if (game.state === 'final') return [
        { text: game.awayAbbr + ' ' + game.awayRuns, fs: 18 },
        { text: game.homeAbbr + ' ' + game.homeRuns, fs: 18 },
        { text: 'Final' + gl,                         fs: gl ? 13 : 14, color: '#FFD700' },
    ];
    return [abbr, '---'];
}

// ── Other-game view for doubleheader toggle ──────────────────────────────────────
function buildOtherLines(other) {
    if (!other) return ['---'];
    const gl = other.gameLabel || '';
    switch (other.state) {
        case 'preview':
            return [{ text: gl, fs: 16, color: '#AAAAAA' }, other.time];
        case 'final':
            return [
                { text: other.awayAbbr + ' ' + other.awayRuns, fs: 18 },
                { text: other.homeAbbr + ' ' + other.homeRuns, fs: 18 },
                { text: gl + ' Final', fs: 13, color: '#FFD700' },
            ];
        case 'live':
            return [
                { text: other.awayAbbr + ' ' + other.awayRuns, fs: 18 },
                { text: other.homeAbbr + ' ' + other.homeRuns, fs: 18 },
                liveInnLine(other.outs, other.half + other.inn + (gl ? ' ' + gl : '')),
            ];
        case 'ppd':
            return [{ text: gl, fs: 16, color: '#AAAAAA' }, { text: other.canceled ? 'CANC' : 'PPD',   fs: 16, color: '#E74C3C' }];
        case 'susp':
            return [{ text: gl, fs: 16, color: '#AAAAAA' }, { text: 'SUSP',  fs: 14, color: '#E74C3C' }];
        case 'delay':
            return [{ text: gl, fs: 16, color: '#AAAAAA' }, { text: 'DELAY', fs: 14, color: '#3498DB' }];
        case 'warmup':
            return [{ text: gl, fs: 16, color: '#AAAAAA' }, { text: 'WARMUP', fs: 12, color: '#2ECC71' }];
        default:
            return [gl, '---'];
    }
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
// Tidies a user-typed Custom Link: trims whitespace and adds https:// when no
// scheme was typed ("www.foxsports.com/live/sny" -> "https://www.foxsports.com/live/sny"),
// since Stream Deck won't open a bare domain as a web page. Returns '' for
// anything that can't be a web link (blank, or a non-http scheme like file:),
// so callers fall back to the default link instead of opening nothing.
function normalizeCustomUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(javascript|data|file|vbscript|mailto):/i.test(s)) return '';
    return 'https://' + s.replace(/^\/+/, '');
}

function buildGameUrl(game, linkType, teamId, customUrl) {
    customUrl = normalizeCustomUrl(customUrl);
    if (!game || !game.gamePk) return 'https://www.milb.com';
    // Winter leagues: MLB.com Gameday for everything (it also follows a postponed
    // game's reassigned gamePk), MLB.TV for the stream option once the game starts
    if (game.isWinter) {
        const mlbGameday = `https://www.mlb.com/gameday/${game.gamePk}`;
        const started = game.state === 'live' || game.state === 'delay-live' || game.state === 'final' || game.state === 'warmup';
        // MLB.TV's /tv/g<gamePk> player says "not available" for winter games; their streams
        // are featured MLB.TV videos — openGameUrl resolves this to the game's own video
        if (linkType === 'tv' && started && !NO_STREAM_LEAGUE_IDS.includes(game.isWinter)) return WINTER_STREAMS_URL;
        if (linkType === 'custom' && started && customUrl) return customUrl;
        return mlbGameday;
    }
    // A postponed (or suspended, pending makeup) game often gets its gamePk reassigned to
    // a new date behind the scenes. MLB.com's Gameday redirects cleanly to the new page,
    // but MiLB.com's site gets stuck in a redirect loop trying to resolve the old link —
    // so instead of the specific /gameday/ page, send to our tracked team's schedule page.
    if (game.state === 'ppd' || game.state === 'susp') {
        // AFL clubs have no MiLB.com club pages — use the league schedule instead
        if (game.isAFL) return AFL_SCHEDULE_URL;
        const ourClubSlug = (teamId && Number(teamId) === game.homeId) ? game.homeClubSlug
                          : (teamId && Number(teamId) === game.awayId) ? game.awayClubSlug
                          : (game.awayClubSlug || game.homeClubSlug);
        return ourClubSlug ? `https://www.milb.com/${ourClubSlug}/schedule` : 'https://www.milb.com';
    }
    // Gameday URL — suffix matches game state
    const suffix = (game.state === 'live' || game.state === 'delay-live') ? 'live'
                 : game.state === 'final' ? 'final'
                 : 'preview';
    const away = game.awaySlug || 'away';
    const home = game.homeSlug || 'home';
    const gamedayUrl = `https://www.milb.com/gameday/${away}-vs-${home}/${game.gameDate}/${game.gamePk}/${suffix}`;
    if (linkType === 'tv') {
        // Only send to the live stream once the game has actually started (or is in Warmup,
        // which MiLB.tv already carries as pre-game coverage) — checking elapsed time against
        // the scheduled start breaks down on a rain delay, where the clock passes first pitch
        // but the game (and stream) hasn't begun yet.
        const gameStarted = game.state === 'live' || game.state === 'delay-live' || game.state === 'final' || game.state === 'warmup';
        if (!gameStarted) {
            return gamedayUrl;
        }
        if (game.isAFL) return AFL_STREAMS_URL;
        return `https://www.milb.com/live-stream-games/g${game.gamePk}`;
    }
    if (linkType === 'custom') {
        // Same pattern as the MiLB.tv option: Gameday until the game actually starts (or is in
        // Warmup), then the user's own link — e.g. a regional sports network's live-game page.
        // Also falls back to Gameday if no URL has been configured yet, so the button never
        // opens a blank tab.
        const gameStarted = game.state === 'live' || game.state === 'delay-live' || game.state === 'final' || game.state === 'warmup';
        if (!gameStarted || !customUrl) {
            return gamedayUrl;
        }
        return customUrl;
    }
    return gamedayUrl;
}

// Opens the key's link. For an AFL game that has started, the stream option would
// otherwise land on the league's live-streams hub — try to resolve that game's own
// stream page first, and fall back to the hub if anything doesn't check out.
async function openGameUrl(game, linkType, cfg, why) {
    let url = buildGameUrl(game, linkType, cfg && cfg.teamId, cfg && cfg.customUrl);
    if (url === AFL_STREAMS_URL) {
        try { url = (await resolveAflStreamUrl(game)) || AFL_STREAMS_URL; }
        catch (e) { log('AFL stream lookup failed:', e.message); url = AFL_STREAMS_URL; }
    }
    if (url === WINTER_STREAMS_URL) {
        try { url = (await resolveWinterStreamUrl(game)) || WINTER_STREAMS_URL; }
        catch (e) { log('Winter stream lookup failed:', e.message); url = WINTER_STREAMS_URL; }
    }
    log(why + ' — opening URL:', url);
    ws.send(JSON.stringify({ event: 'openUrl', payload: { url } }));
}

// ── AFL per-game streams ──────────────────────────────────────────────────────
// Each AFL stream is an MLB.com video, /video/live-fall-league-<away>-<home>-<id>
// (doubleheaders add -1/-2 before the id). The id is an arbitrary CMS number — not
// the gamePk, and not in the Stats API — so we read it off the live-streams hub,
// which lists only the current day's games as "video-player" slots (the archive is
// separate). The video page's title carries the game date ("… | 10/03/2026"), which
// we check so a stale slot for the same matchup can't send you to an old game.
// Found links are cached per game; misses are retried after 2 minutes.
const aflStreamCache = new Map();   // gamePk|label -> { url, at } (url null = miss)
const AFL_MISS_RETRY_MS = 2 * 60 * 1000;

function httpGetText(url, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (StreamDeckMiLBScores)' } }, res => {
            if (res.statusCode !== 200) { res.resume(); return resolve(null); }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => body += c);
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout ' + url)); });
    });
}

async function resolveAflStreamUrl(game) {
    const [awayAbbr, homeAbbr] = String(game.matchup || '').split(' @ ');
    if (!awayAbbr || !homeAbbr || !game.gamePk) return null;
    const dh  = game.gameLabel === 'G1' ? '1' : game.gameLabel === 'G2' ? '2' : null;
    const key = game.gamePk + '|' + (dh || '');
    const hit = aflStreamCache.get(key);
    if (hit && (hit.url || Date.now() - hit.at < AFL_MISS_RETRY_MS)) return hit.url;

    let url = null;
    const hub = await httpGetText(AFL_STREAMS_URL);
    if (hub) {
        const prefix = 'live-fall-league-' + awayAbbr.toLowerCase() + '-' + homeAbbr.toLowerCase() + '-';
        const slugs  = [...hub.matchAll(/"type":"video-player","slug":"(live-fall-league-[a-z0-9-]+)"/g)]
                           .map(m => m[1]).filter(sl => sl.startsWith(prefix));
        const want   = dh ? new RegExp('^' + dh + '-\\d+$') : /^\d+$/;
        const slug   = slugs.find(sl => want.test(sl.slice(prefix.length))) || slugs[0];
        if (slug) {
            const page  = await httpGetText('https://www.mlb.com/video/' + slug);   // null = not live yet (404)
            const m     = page && page.match(/og:title" content="[^"]*\| (\d{2})\/(\d{2})\/(\d{4})"/);
            const date  = m ? m[3] + '/' + m[1] + '/' + m[2] : null;               // -> YYYY/MM/DD
            if (date === game.gameDate) url = 'https://www.mlb.com/video/' + slug;
            else log('AFL stream:', slug, 'date', date, '!= game', game.gameDate);
        } else {
            log('AFL stream: no hub slot for', prefix);
        }
    }
    aflStreamCache.set(key, { url, at: Date.now() });
    return url;
}

// ── Winter league per-game streams (LMP / LIDOM on MLB.TV) ────────────────────
// Each stream is an MLB.TV video, /tv/shows/p/mlbtv-featured-svod-video-list/s/<slug>
// (e.g. lmp-live-charros-vs-jaguares-250900). The slug's number is a CMS id and the
// names aren't consistent, but MLB's CMS feed behind that list tags every video with
// its game ("gamepk-850558"), so we match on the gamePk. The feed (~90 KB, newest
// first) is only fetched on a stream press for a game that has started. Hits are
// cached per game; misses are retried after 2 minutes; any failure → the list page.
const WINTER_STREAMS_FEED = 'https://dapi.cms.mlbinfra.com/v2/content/en-us/sel-mlbtv-featured-svod-video-list';
const winterStreamCache   = new Map();   // gamePk -> { url, at } (url null = miss)

async function resolveWinterStreamUrl(game) {
    if (!game.gamePk) return null;
    const hit = winterStreamCache.get(game.gamePk);
    if (hit && (hit.url || Date.now() - hit.at < AFL_MISS_RETRY_MS)) return hit.url;
    let url = null;
    const body = await httpGetText(WINTER_STREAMS_FEED);
    if (body) {
        const want = 'gamepk-' + game.gamePk;
        const item = (JSON.parse(body).items || []).find(it => (it.tags || []).some(t => t.slug === want));
        if (item && item.slug) url = 'https://www.mlb.com/tv/shows/p/mlbtv-featured-svod-video-list/s/' + item.slug;
        else log('Winter stream: no video tagged', want);
    }
    winterStreamCache.set(game.gamePk, { url, at: Date.now() });
    return url;
}

// ── MLB Stats API ─────────────────────────────────────────────────────────────
const SPORT_IDS   = '11,12,13,14,17';
const AFL_LEAGUE_ID = 119;
// Caribbean / Mexican winter leagues, also in sport 17 (added 1.0.37.0):
// 131 Dominican (LIDOM), 132 Mexican Pacific (LMP), 135 Venezuela (LVBP);
// 133 Puerto Rico (LBPRC), 595 Australia (ABL) and 162 Caribbean Series added in 1.0.39.0.
// MLB.com Gameday covers their games (/gameday/<gamePk> redirects to the full page);
// LMP and LIDOM stream on MLB.TV as featured videos (see WINTER_STREAMS_URL), and Puerto Rico is
// treated the same way (the lookup falls back to the MLB.TV list if it finds nothing). No MiLB.com pages, no parent orgs.
const WINTER_LEAGUE_IDS = [131, 132, 135, 133, 595, 162];
// isWinter holds the league id (truthy) so links can tell the leagues apart
const isWinterLeague = id => WINTER_LEAGUE_IDS.includes(id) ? id : false;
// Leagues with no stream link (Venezuela, Puerto Rico, Australia, Caribbean Series) — the stream option opens Gameday instead
const NO_STREAM_LEAGUE_IDS = [135, 133, 595, 162];
const WINTER_STREAMS_URL = 'https://www.mlb.com/tv/shows/mlbtv-featured-svod-video-list';
const AFL_SCHEDULE_URL = 'https://www.mlb.com/arizona-fall-league/schedule';
// AFL games stream free on MLB.com, not MiLB.tv. Each stream is a CMS video
// (e.g. /video/live-fall-league-gdd-mss-193557) whose ID isn't tied to the gamePk
// and isn't exposed by the Stats API, so we open the league's stream hub instead.
const AFL_STREAMS_URL  = 'https://www.mlb.com/arizona-fall-league/live-streams';
// "Today" as YYYY-MM-DD. The schedule's dates are US dates, so "today" is read
// in America/New_York rather than from the host clock — a viewer in London or
// Tokyo would otherwise ask for tomorrow's slate while tonight's games were
// still on. The day rolls over at 5:00 AM Eastern (= 2:00 AM Pacific, the old
// West Coast behavior), so a late-running game or its final stays on the key
// well past midnight everywhere. Built-in Intl only.
const ET_ZONE   = 'America/New_York';
const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});
const DAY_ROLLOVER_ET_HOUR = 5;

function etParts(ms) {
    const o = {};
    for (const p of ET_FORMAT.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { year: +o.year, month: +o.month, day: +o.day };
}
function scheduleDate() {
    const p = etParts(Date.now() - DAY_ROLLOVER_ET_HOUR * 3600e3);
    return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
}
// YYYY-MM-DD plus n days, by calendar (host timezone and DST can't matter).
function addDays(ymd, n) {
    const d = new Date(ymd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

// ── Shared fetch cache ────────────────────────────────────────────────────────
// Every schedule read goes through cachedJson(): one request per URL per TTL no
// matter how many keys ask for it, and keys that ask while the request is still
// in flight share its promise — so keys that start together (a page switch, or
// the plugin starting with a full page) cost 1 request, not one each.
//
// If the feed stops answering, the last good response for that same URL keeps
// driving the keys for up to STALE_MAX_MS instead of dropping every key to
// "Err", and a small amber dot marks them as not live (isStale(), drawn by
// setButton). Failures with nothing usable cached still reject, as before.
const FETCH_TTL_MS = 20_000;
const STALE_MAX_MS = 10 * 60_000;
const jsonCache = new Map(); // url -> { at, promise }
const jsonGood  = new Map(); // url -> { at, data }   last good response
const jsonFails = new Map(); // url -> time it started failing (served stale since)

// Per key: a key shows the dot only when a URL for ITS team is being served stale
// (both of a key's reads carry "&teamId=<id>&"), so one club's hiccup doesn't
// mark every other key as not live.
function isStale(teamId) {
    const now = Date.now();
    for (const [u, t] of jsonFails) if (now - t > STALE_MAX_MS) jsonFails.delete(u);
    if (!teamId || jsonFails.size === 0) return false;
    const needle = '&teamId=' + teamId + '&';
    for (const u of jsonFails.keys()) if (u.includes(needle)) return true;
    return false;
}

function cachedJson(url, ttlMs = FETCH_TTL_MS) {
    const now = Date.now();
    const hit = jsonCache.get(url);
    if (hit && now - hit.at < ttlMs) return hit.promise;

    // keep the maps bounded: dated URLs pile up over a long session
    for (const [u, v] of jsonCache) if (now - v.at > STALE_MAX_MS) jsonCache.delete(u);
    for (const [u, v] of jsonGood)  if (now - v.at > STALE_MAX_MS) jsonGood.delete(u);

    const promise = httpsGetJson(url).then(data => {
        jsonGood.set(url, { at: Date.now(), data });
        if (jsonFails.delete(url)) log('Feed answering again — data live');
        return data;
    }, err => {
        const good = jsonGood.get(url);
        if (good && Date.now() - good.at < STALE_MAX_MS) {
            if (!jsonFails.has(url)) { jsonFails.set(url, Date.now()); log('Feed failed — showing cached data:', err.message); }
            return good.data;
        }
        if (jsonCache.get(url) && jsonCache.get(url).promise === promise) jsonCache.delete(url); // retry on the next poll
        throw err;
    });
    jsonCache.set(url, { at: now, promise });
    return promise;
}

// GET a URL as parsed JSON. The socket timeout only fires when the connection
// goes quiet, so FETCH_DEADLINE_MS caps the whole request, and the promise
// settles exactly once whichever way it ends.
const FETCH_DEADLINE_MS = 20_000;

function httpsGetJson(url) {
    return new Promise((resolve, reject) => {
        let settled = false, deadline = null;
        const settle = (fn, value) => { if (settled) return; settled = true; clearTimeout(deadline); fn(value); };

        const req = https.get(url, { headers: { 'User-Agent': 'StreamDeckMiLBScores/1.0' } }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('error', e => settle(reject, e));
            res.on('end', () => {
                try { settle(resolve, JSON.parse(body)); }
                catch (e) { settle(reject, e); }
            });
        });

        deadline = setTimeout(() => { req.destroy(); settle(reject, new Error('Request timed out')); }, FETCH_DEADLINE_MS);
        req.on('error', e => settle(reject, e));
        req.setTimeout(10_000, () => { req.destroy(); settle(reject, new Error('Request timed out')); });
    });
}

const NEXT_GAME_TTL_MS = 5 * 60_000; // off-day lookups: the schedule rarely changes, so don't ask every 30 s per key

async function fetchTodayGame(teamId) {
    const date = scheduleDate();
    // sportId=11,12,13,14 covers Triple-A, Double-A, High-A, Single-A; 17 adds the
    // Arizona Fall League and the Mexican / Venezuelan / Dominican winter leagues
    // (sport 17 is all winter leagues; we query by teamId, so only the tracked club comes back)
    const url = 'https://statsapi.mlb.com/api/v1/schedule' +
                '?sportId=' + SPORT_IDS + '&date=' + date +
                '&teamId=' + teamId +
                '&hydrate=linescore,team';

    const game = parseSchedule(await cachedJson(url));
    if (game) return game;
    // Truly an off day — look ahead to the next scheduled game instead of a dead end
    try { return await fetchNextGame(teamId, date); } catch (e) { return null; }
}

// ── Next scheduled game (shown on off days instead of a dead-end "No Game") ──
// Looks ahead up to two weeks from the given date for this team's next game.
async function fetchNextGame(teamId, afterDate) {
    const url = 'https://statsapi.mlb.com/api/v1/schedule' +
                '?sportId=' + SPORT_IDS + '&teamId=' + teamId +
                '&startDate=' + addDays(afterDate, 1) + '&endDate=' + addDays(afterDate, 15) +
                '&hydrate=team';

    const data  = await cachedJson(url, NEXT_GAME_TTL_MS);
    const dates = data?.dates || [];
    for (const d of dates) {
        const games = (d.games || []).slice().sort((a, b) => (a.gameNumber || 1) - (b.gameNumber || 1));
        for (const g of games) {
            const homeAbbr = g?.teams?.home?.team?.abbreviation || 'HME';
            const awayAbbr = g?.teams?.away?.team?.abbreviation || 'AWY';
            const homeName = g?.teams?.home?.team?.teamName;
            const awayName = g?.teams?.away?.team?.teamName;
            if (!homeName || !awayName) continue;
            const matchup   = awayAbbr + ' @ ' + homeAbbr;
            const startISO  = g.gameDate || null;
            // Use the schedule bucket's official date, not the game's UTC timestamp —
            // slicing the ISO string rolls to the next day for any West Coast/Mountain
            // evening game whose UTC start crosses midnight (e.g. 7:10pm MT = 1:10am UTC).
            const gameDate  = d.date ? d.date.replace(/-/g, '/') : '2000/01/01';
            const startTBD  = g.status?.startTimeTBD || false;
            const time = startTBD ? 'TBD' : fmtTime(startISO);
            return {
                state: 'nextgame', matchup, startISO, time, gamePk: g.gamePk, gameDate,
                isWinter: isWinterLeague(g?.teams?.home?.team?.league?.id),
                homeSlug: toSlug(homeName), awaySlug: toSlug(awayName),
            };
        }
    }
    return null;
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

        // The schedule bucket's official date — use this for Gameday URLs, not the game's
        // raw UTC timestamp, which rolls to the next calendar day for West Coast/Mountain
        // evening games (e.g. 7:05pm MT = 1:05am UTC the following day).
        const officialDate = data.dates[0].date ? data.dates[0].date.replace(/-/g, '/') : '2000/01/01';

        // Sort by gameNumber so doubleheaders are always Game 1 first, Game 2 second
        games.sort((a, b) => (a.gameNumber || 1) - (b.gameNumber || 1));

        const isDoubleheader = games.length >= 2;

        // A game is "done for today" if it's final, postponed, or suspended
        const isDone = g => {
            const det = g?.status?.detailedState || '';
            const abs = g?.status?.abstractGameState || '';
            return det.startsWith('Postponed') || det.startsWith('Suspended') || abs === 'Final';
        };

        // Show Game 1 until it's done, then automatically switch to Game 2
        let gameIndex = 0;
        if (isDoubleheader && isDone(games[0])) gameIndex = 1;

        const g         = games[gameIndex];
        const gameLabel = isDoubleheader ? (gameIndex === 0 ? 'G1' : 'G2') : null;

        // Build a summary of the OTHER game for the doubleheader toggle
        let otherGame = null;
        if (isDoubleheader) {
            const og         = games[gameIndex === 0 ? 1 : 0];
            const ogLabel    = gameIndex === 0 ? 'G2' : 'G1';
            const ogStatus   = og?.status?.abstractGameState;
            const ogDetail   = og?.status?.detailedState || '';
            const ogHomeAbbr = og?.teams?.home?.team?.abbreviation || 'HME';
            const ogAwayAbbr = og?.teams?.away?.team?.abbreviation || 'AWY';
            const ogLs       = og.linescore;
            // Common fields needed by buildGameUrl so single-click opens the right game
            const ogBase     = {
                gameLabel:    ogLabel,
                gamePk:       og.gamePk,
                gameDate:     officialDate,
                homeSlug:     toSlug(og?.teams?.home?.team?.teamName),
                awaySlug:     toSlug(og?.teams?.away?.team?.teamName),
                homeClubSlug:  toSlug(og?.teams?.home?.team?.shortName),
                awayClubSlug:  toSlug(og?.teams?.away?.team?.shortName),
                homeId:       og?.teams?.home?.team?.id,
                awayId:       og?.teams?.away?.team?.id,
                isAFL:        og?.teams?.home?.team?.league?.id === AFL_LEAGUE_ID,
                isWinter:     isWinterLeague(og?.teams?.home?.team?.league?.id),
            };
            if (ogDetail.startsWith('Cancel')) {
                otherGame = { ...ogBase, state: 'ppd', canceled: true };
            } else if (ogDetail.startsWith('Postponed')) {
                otherGame = { ...ogBase, state: 'ppd' };
            } else if (ogDetail.startsWith('Suspended')) {
                otherGame = { ...ogBase, state: 'susp' };
            } else if (ogDetail.toLowerCase().includes('delay')) {
                otherGame = { ...ogBase, state: 'delay' };
            } else if (ogStatus === 'Preview') {
                const ogTBD = og.status?.startTimeTBD || false;
                otherGame = { ...ogBase, state: 'preview', time: ogTBD ? 'TBD' : fmtTime(og.gameDate) };
            } else if (ogStatus === 'Final') {
                otherGame = { ...ogBase, state: 'final',
                    homeAbbr: ogHomeAbbr, awayAbbr: ogAwayAbbr,
                    homeRuns: ogLs?.teams?.home?.runs ?? 0,
                    awayRuns: ogLs?.teams?.away?.runs ?? 0 };
            } else if (ogStatus === 'Live') {
                const ogInn  = ogLs?.currentInning || '?';
                const ogHalf = ogLs?.inningHalf === 'Top' ? '▲' : '▼';
                otherGame = { ...ogBase, state: 'live',
                    homeAbbr: ogHomeAbbr, awayAbbr: ogAwayAbbr,
                    homeRuns: ogLs?.teams?.home?.runs ?? 0,
                    awayRuns: ogLs?.teams?.away?.runs ?? 0,
                    inn: ogInn, half: ogHalf, outs: ogLs?.outs ?? 0 };
            }
        }

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
        // MiLB.com's club schedule pages use a slug based on the team's brand/region name
        // (shortName, e.g. "somerset", "hudson-valley") — NOT locationName, which is the
        // literal city the team plays in and can differ from the brand (Somerset Patriots
        // play in Bridgewater, Hudson Valley Renegades play in Wappingers Falls). Needed
        // for the postponed-game fallback link below.
        const homeClubSlug     = toSlug(g?.teams?.home?.team?.shortName);
        const awayClubSlug     = toSlug(g?.teams?.away?.team?.shortName);
        const homeParentOrgId = g?.teams?.home?.team?.parentOrgId || g?.teams?.home?.team?.parentTeamId;
        const awayParentOrgId = g?.teams?.away?.team?.parentOrgId || g?.teams?.away?.team?.parentTeamId;
        const matchup     = awayAbbr + ' @ ' + homeAbbr;
        const gamePk      = g.gamePk;
        const gameDate    = officialDate;
        const ls          = g.linescore;
        const startTBD    = g.status?.startTimeTBD || false;
        const isAFL       = g?.teams?.home?.team?.league?.id === AFL_LEAGUE_ID;
        const isWinter    = isWinterLeague(g?.teams?.home?.team?.league?.id);

        log('API:', status, detailed, matchup, 'pk=' + gamePk, gameLabel || '');

        // Special states — check detailedState first so they override abstractGameState
        // A rainout MLB cancels outright comes back as abstractGameState 'Final' with
        // detailedState 'Cancelled' — catch it before the Final branch turns it into a 0-0 final.
        if (detailed.startsWith('Cancel'))            return { state: 'ppd',   canceled: true,   matchup, gamePk, gameDate, homeSlug, awaySlug, homeClubSlug, awayClubSlug, homeId, awayId, isAFL, isWinter, gameLabel, otherGame };
        if (detailed.startsWith('Postponed'))         return { state: 'ppd',   matchup, gamePk, gameDate, homeSlug, awaySlug, homeClubSlug, awayClubSlug, homeId, awayId, isAFL, isWinter, gameLabel, otherGame };
        if (detailed.startsWith('Suspended'))         return { state: 'susp',  matchup, gamePk, gameDate, homeSlug, awaySlug, homeClubSlug, awayClubSlug, homeId, awayId, isAFL, isWinter, gameLabel, otherGame };
        if (detailed.toLowerCase().includes('delay')) {
            // Distinguish a pre-game delay (e.g. "Delayed Start", status still "Preview")
            // from a mid-game delay (status "Live"). MLB's linescore pre-populates a "Top 1"
            // shell with a defense/offense lineup before first pitch, so checking for
            // linescore.currentInning is NOT a reliable signal that the game has started —
            // abstractGameState is the authoritative source.
            if (status === 'Live') {
                const homeRuns = ls?.teams?.home?.runs ?? 0;
                const awayRuns = ls?.teams?.away?.runs ?? 0;
                return { state: 'delay-live', matchup, homeAbbr, awayAbbr, homeSlug, awaySlug, homeId, awayId, homeRuns, awayRuns, gamePk, gameDate, homeName, awayName, homeParentOrgId, awayParentOrgId, isAFL, isWinter, gameLabel, otherGame };
            }
            return { state: 'delay', matchup, time: startTBD ? 'TBD' : fmtTime(g.gameDate), startISO: g.gameDate || null, gamePk, gameDate, homeSlug, awaySlug, homeId, awayId, isAFL, isWinter, gameLabel, otherGame };
        }

        if (status === 'Preview') {
            const time = startTBD ? 'TBD' : fmtTime(g.gameDate);
            return { state: 'preview', matchup, time, startISO: g.gameDate || null, gamePk, gameDate, homeSlug, awaySlug, homeId, awayId, homeName, awayName, homeParentOrgId, awayParentOrgId, isAFL, isWinter, gameLabel, otherGame };
        }

        // The API flips abstractGameState to "Live" during pre-game warmups before first pitch.
        // Keep showing the start time until play actually begins.
        if (detailed === 'Pre-Game') {
            const time = startTBD ? 'TBD' : fmtTime(g.gameDate);
            return { state: 'preview', matchup, time, startISO: g.gameDate || null, gamePk, gameDate, homeSlug, awaySlug, homeId, awayId, homeName, awayName, homeParentOrgId, awayParentOrgId, isAFL, isWinter, gameLabel, otherGame };
        }
        // Warmup means the game (possibly just coming out of a rain delay) is about to start —
        // the original scheduled time is stale at this point, so label it explicitly instead
        // of showing a clock that's already passed.
        if (detailed === 'Warmup') {
            const time = startTBD ? 'TBD' : fmtTime(g.gameDate);
            return { state: 'warmup', matchup, time, startISO: g.gameDate || null, gamePk, gameDate, homeSlug, awaySlug, homeId, awayId, homeName, awayName, homeParentOrgId, awayParentOrgId, isAFL, isWinter, gameLabel, otherGame };
        }

        const homeRuns = ls?.teams?.home?.runs ?? 0;
        const awayRuns = ls?.teams?.away?.runs ?? 0;

        if (status === 'Final') {
            return { state: 'final', matchup, homeAbbr, awayAbbr, homeSlug, awaySlug, homeId, awayId, homeRuns, awayRuns, gamePk, gameDate, homeName, awayName, homeParentOrgId, awayParentOrgId, isAFL, isWinter, gameLabel, otherGame };
        }

        // Live
        const inn  = ls?.currentInning || '?';
        const half = ls?.inningHalf === 'Top' ? '\u25b2' : '\u25bc';

        return { state: 'live', matchup, homeAbbr, awayAbbr, homeSlug, awaySlug, homeId, awayId, homeRuns, awayRuns, inn, half, outs: ls?.outs ?? 0, gamePk, gameDate, homeName, awayName, homeParentOrgId, awayParentOrgId, isAFL, isWinter, gameLabel, otherGame };

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

// Turns a user-chosen hex color + opacity (0-100) from the property inspector
// into a CSS color the SVG <rect> can use directly. Falls back to plain black
// for anyone who hasn't set a custom background — same look as before this
// feature existed. This is deliberately only applied to the steady-state
// button (pre-game/live/final/err) — the score-flash and end-of-game
// fireworks effects keep using their own dynamic colors on top of it.
function resolveBgColor(cfg) {
    if (!cfg || !cfg.bgColor) return { fill: 'black', opacity: 1 };
    const hex = String(cfg.bgColor).replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { fill: 'black', opacity: 1 };
    const opacityPct = cfg.bgOpacity != null ? Number(cfg.bgOpacity) : 100;
    const opacity     = Math.max(0, Math.min(100, isNaN(opacityPct) ? 100 : opacityPct)) / 100;
    return { fill: '#' + hex, opacity };
}

// ── Stacked pregame layout ────────────────────────────────────────────────────
// Every pregame / upcoming-game key, on team keys and Scoreboard keys alike:
//   AWAY            (16)
//   @ HOME          (16, with a small "@" — or "vs" at neutral sites — raised
//                    to the middle of the capitals; the whole line centered)
//   Wednesday       (11.5, gray) — the weekday; "Sat 10/24" when 7+ days out
//   12:00 PM        (11.5) — or TBD when the start time isn't set
// On game day the day line goes away and the time is shown larger (14).
// One size for every matchup in every league; settled on real hardware
// (Windows + XL, Mac + Mini) with a separate font-test plugin, 2026-10-17.
const PRE_TEAM_FS = 16, PRE_AT_FS = 10, PRE_DAY_FS = 11.5, PRE_TIME_FS = 11.5, PRE_GAMEDAY_TIME_FS = 14;
const PRE_SPACING = 1.12, PRE_DAY_COLOR = '#BBBBBB', PRE_MAX_W = 66;
// Helvetica-Bold advance widths (per 1000 em) — only used to shrink a team line
// that can't fit at 16 (e.g. G League's RCITY / VALLEY); unknown glyphs count wide.
const PRE_GLYPHS = {
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
    J: 556, K: 722, L: 611, M: 889, N: 722, O: 778, P: 667, Q: 778, R: 722,
    S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
    '&': 778, '-': 333, '.': 278, '@': 975, v: 556, s: 556, ' ': 278,
};
function preWidth(str, fs) {
    let u = 0;
    for (const ch of String(str)) u += PRE_GLYPHS[ch] !== undefined ? PRE_GLYPHS[ch] : 800;
    return u * fs / 1000;
}
function preFitFs(extraPx, text) {
    let fs = PRE_TEAM_FS;
    while (fs > 9 && extraPx + preWidth(text, fs) > PRE_MAX_W) fs -= 0.5;
    return fs;
}

// Day/time text for an upcoming game, by calendar days in the viewer's local time:
// game day → { day: null, time }, 1–6 days → { day: 'Thursday', time },
// 7+ days → { day: 'Sat 10/24', time }. tbd → time 'TBD'.
// A TBD game's placeholder time is often midnight Eastern, so its date is read
// in Eastern time (otherwise it would land on the day before out West).
function pregameWhen(iso, now, tbd) {
    try {
        const d = new Date(iso), n = now || new Date();
        const tz = tbd ? { timeZone: 'America/New_York' } : {};
        const ymd = x => Date.parse(x.toLocaleDateString('en-CA', tz) + 'T00:00:00Z'); // YYYY-MM-DD
        const days = Math.round((ymd(d) - ymd(n)) / 86400000);
        const time = tbd ? 'TBD' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (days <= 0) return { day: null, time };
        if (days < 7)  return { day: d.toLocaleDateString([], { weekday: 'long', ...tz }), time };
        return { day: d.toLocaleDateString([], { weekday: 'short', ...tz }) + ' ' + d.toLocaleDateString([], { month: 'numeric', day: 'numeric', ...tz }), time };
    } catch (e) { return { day: null, time: tbd ? 'TBD' : '' }; }
}

// Lines for a stacked pregame key. `last` (a line or an array of lines) replaces
// the day/time lines (PPD / DELAY / WARMUP).
function pregameLines(awayAbbr, homeAbbr, neutral, day, time, last) {
    const pre = neutral ? 'vs' : '@';
    const lines = [
        { text: awayAbbr, fs: preFitFs(0, awayAbbr) },
        { home: homeAbbr, pre, afs: PRE_AT_FS, fs: preFitFs(preWidth(pre + ' ', PRE_AT_FS), homeAbbr) },
    ];
    if (Array.isArray(last)) lines.push(...last);
    else if (last) lines.push(last);
    else if (day) lines.push({ text: day, fs: PRE_DAY_FS, color: PRE_DAY_COLOR }, { text: time, fs: PRE_TIME_FS });
    else          lines.push({ text: time, fs: PRE_GAMEDAY_TIME_FS });
    lines.spacing = PRE_SPACING;
    return lines;
}

// SVG for the "@ HOME" line. Stream Deck's renderer ignores dy / baseline
// shifts, so the line is drawn twice in the same centered layout: first with
// the "@" invisible, then with only the "@" visible, lifted so its middle sits
// at the middle of the capitals. Both copies lay out identically on any font.
function preHomeLineSvg(y, fs, item, color) {
    const lift  = 0.344 * fs - 0.276 * item.afs - 0.4;
    const attrs = `x="36" text-anchor="middle" xml:space="preserve" font-family="Helvetica Neue,Arial,sans-serif" font-size="${fs}" font-weight="600" fill="${color || 'white'}"`;
    const pre   = escXml(item.pre + ' '), home = escXml(item.home);
    return `<text y="${y.toFixed(2)}" ${attrs}><tspan font-size="${item.afs}" fill="none">${pre}</tspan><tspan>${home}</tspan></text>` +
           `<text y="${(y - lift).toFixed(2)}" ${attrs}><tspan font-size="${item.afs}">${pre}</tspan><tspan fill="none">${home}</tspan></text>`;
}


// Baseball pregame keys on the stacked layout. Doubleheaders put the game number
// on the day line: "Game 2" on game day, "Sat G2" / "Sat 10/24 G2" on a later day.
function baseballPregameLines(game, last) {
    const [away, home] = String(game.matchup || '').split(' @ ');
    const tbd  = game.time === 'TBD';
    const when = game.startISO ? pregameWhen(game.startISO, new Date(), tbd) : { day: null, time: game.time };
    let day = when.day;
    if (game.gameLabel) {
        const g = game.gameLabel;
        day = !day ? 'Game ' + g.replace(/^G/, '') : (day.includes(' ') ? day : day.slice(0, 3)) + ' ' + g;
    }
    if (typeof last === 'function') return pregameLines(away, home, false, null, null, last(when, day));
    return pregameLines(away, home, false, day, when.time, last);
}

function makeImage(lines, lineSpacing = 1.4, bgColor = 'black', bgOpacity = 1, stale = false) {
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

    const rows = items.map((item, i) => {
        const { text, fs, color } = item;
        if (i > 0) y += lineHeights[i - 1] - items[i - 1].fs * 0.80 + fs * 0.80;
        if (item.home !== undefined) return preHomeLineSvg(y, fs, item, color);
        if ('dotFill1' in item) {
            const cy = (y - 5).toFixed(1);
            // Estimate text width so the full group [dot dot text] is centered at x=36.
            // Math: dot1X = 29 - textW/2; textX always resolves to 46.5 regardless of width.
            const estW = Array.from(item.innText.trim()).reduce(
                (w, ch) => w + (ch === ' ' ? item.innFs * 0.3 : item.innFs * 0.55), 0);
            const dot1X = (29 - estW / 2).toFixed(1);
            const dot2X = (29 - estW / 2 + 9).toFixed(1);
            return `<circle cx="${dot1X}" cy="${cy}" r="3.5" fill="${item.dotFill1}"/>` +
                   `<circle cx="${dot2X}" cy="${cy}" r="3.5" fill="${item.dotFill2}"/>` +
                   `<text x="46.5" y="${y.toFixed(1)}" text-anchor="middle" fill="#FFD700" ` +
                   `font-family="Helvetica Neue,Arial,sans-serif" font-size="${item.innFs}" font-weight="600">${escXml(item.innText)}</text>`;
        }
        return `<text x="36" y="${y.toFixed(1)}" text-anchor="middle" fill="${color || 'white'}" ` +
               `font-family="Helvetica Neue,Arial,sans-serif" font-size="${fs}" font-weight="600">${escXml(text)}</text>`;
    }).join('');

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="144" height="144" overflow="hidden">` +
        `<rect width="${W}" height="${H}" fill="${bgColor}" fill-opacity="${bgOpacity}"/>` +
        rows + (stale ? `<circle cx="65" cy="7" r="3.2" fill="#FFB020"/>` : '') + `</svg>`;

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
        if (!instances.has(context)) return; // key left the screen mid-animation — nothing to redraw
        refreshButton(context);
    }
}

// bgColor may be a plain CSS color string (flash colors, 'black') or a
// { fill, opacity } object (resolveBgColor's output) — normalized to the
// latter here so makeImage always gets a fill string + numeric opacity.
function setButton(context, lines, lineSpacing, bgColor, force) {
    const bg = (bgColor && typeof bgColor === 'object') ? bgColor : { fill: bgColor || 'black', opacity: 1 };
    const stale = isStale((instances.get(context) || {}).teamId);
    const key = JSON.stringify({ lines, bg, stale });
    if (!force) {
        if (lastRender.get(context) === key) return;
        lastRender.set(context, key);
    }
    ws.send(JSON.stringify({ event: 'setImage', context, payload: { image: makeImage(lines, lineSpacing, bg.fill, bg.opacity, stale), target: 0 } }));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Runs card shown after the score flash: scoring team (white) / "+# RUNS"
// (yellow), always on a black key. Fixed sizes so every card looks the same —
// "+1 RUN" through "+9 RUNS" all fit at 14pt; only +10 or more shrinks.
const RUNS_CARD_MS = 3000;

function runsCardLines(abbr, runs) {
    if (!abbr || !(runs > 0)) return null;
    const r   = '+' + runs + (runs === 1 ? ' RUN' : ' RUNS');
    const rfs = r.length <= 7 ? 14 : Math.floor(62 / (r.length * 0.62));
    const tfs = Math.min(24, Math.floor(64 / (abbr.length * 0.62)));
    return [{ text: abbr, fs: tfs }, { text: r, fs: rfs, color: '#FFD700' }];
}

// Score flash: 5 solid blinks of the color with no text (2.0 s), then the
// runs card for 3 s if there is one, then back to the score.
async function flashButton(context, color, lines, spacing, restColor = 'black', card = null) {
    if (flashing.has(context)) return;
    flashing.add(context);
    log('→ flash', color, card ? JSON.stringify(card) : '');
    try {
        for (let i = 0; i < 5; i++) {
            if (!instances.has(context)) return; // key was removed mid-flash
            setButton(context, [''], spacing, color, true);
            await sleep(200);
            setButton(context, [''], spacing, restColor, true);
            await sleep(200);
        }
        if (card && instances.has(context)) {
            setButton(context, card, 1.3, 'black', true);
            await sleep(RUNS_CARD_MS);
        }
    } finally {
        flashing.delete(context);
        if (instances.has(context)) setButton(context, lines, spacing, restColor, true);
    }
}
