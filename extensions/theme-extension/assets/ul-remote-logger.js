

(function() {
  'use strict';

  const CONFIG = {
    enabled: true,
    endpoint: '/apps/customizer/api/debug/log',
    batchSize: 10,
    flushInterval: 3000,
    maxQueueSize: 100,
    prefixes: ['[UL', '[Preflight', '[THREE', '[Texture', '[Decal', '[GLB', '[WebGL']
  };

  let logQueue = [];
  let flushTimeout = null;

  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console)
  };

  function shouldCapture(args) {
    if (!args || args.length === 0) return false;

    const firstArg = String(args[0]);
    return CONFIG.prefixes.some(prefix => firstArg.includes(prefix));
  }

  function formatArgs(args) {
    return Array.from(args).map(arg => {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 0);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  function queueLog(level, args) {
    if (!CONFIG.enabled) return;
    if (!shouldCapture(args)) return;

    const entry = {
      level,
      message: formatArgs(args),
      time: new Date().toISOString()
    };

    logQueue.push(entry);

    if (logQueue.length > CONFIG.maxQueueSize) {
      logQueue = logQueue.slice(-CONFIG.maxQueueSize);
    }

    if (!flushTimeout) {
      flushTimeout = setTimeout(flushLogs, CONFIG.flushInterval);
    }

    if (logQueue.length >= CONFIG.batchSize) {
      flushLogs();
    }
  }

  async function flushLogs() {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }

    if (logQueue.length === 0) return;

    const logsToSend = logQueue.slice();
    logQueue = [];

    try {
      const response = await fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logs: logsToSend,
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {

        logQueue = logsToSend.concat(logQueue).slice(-CONFIG.maxQueueSize);
      }
    } catch (error) {

      logQueue = logsToSend.concat(logQueue).slice(-CONFIG.maxQueueSize);
    }
  }

  console.log = function(...args) {
    originalConsole.log.apply(console, args);
    queueLog('log', args);
  };

  console.warn = function(...args) {
    originalConsole.warn.apply(console, args);
    queueLog('warn', args);
  };

  console.error = function(...args) {
    originalConsole.error.apply(console, args);
    queueLog('error', args);
  };

  console.info = function(...args) {
    originalConsole.info.apply(console, args);
    queueLog('info', args);
  };

  window.addEventListener('beforeunload', () => {
    if (logQueue.length > 0) {

      try {
        navigator.sendBeacon(CONFIG.endpoint, JSON.stringify({
          logs: logQueue,
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString()
        }));
      } catch {

      }
    }
  });

  window.ULRemoteLogger = {
    flush: flushLogs,
    getQueue: () => logQueue.slice(),
    setEnabled: (enabled) => { CONFIG.enabled = enabled; },
    isEnabled: () => CONFIG.enabled
  };

  originalConsole.log('[ULRemoteLogger] Initialized - capturing logs with prefixes:', CONFIG.prefixes.join(', '));
})();
