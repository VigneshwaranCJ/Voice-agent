/*
 * Website chat widget. Embed on any site:
 *   <script src="https://YOUR-DASHBOARD/widget.js" data-agent="AGENT_ID" async></script>
 * Optional: data-color="#0071e3"  data-title="Chat with us"  data-position="left"
 *
 * Plain HTTP (no WebSockets), so it works on any host. Styles live in a Shadow DOM so they can't clash with the
 * host page, and every message is inserted as text (never HTML).
 */
(function () {
  'use strict'
  var script = document.currentScript || document.querySelector('script[data-agent][src*="widget.js"]')
  if (!script || window.__vcWidgetLoaded) return
  window.__vcWidgetLoaded = true

  var AGENT = script.getAttribute('data-agent')
  if (!AGENT) { console.warn('[widget] data-agent is missing'); return }
  var BASE = new URL(script.src, location.href).origin + '/api/v1/public'
  var COLOR = /^#[0-9a-f]{3,8}$/i.test(script.getAttribute('data-color') || '') ? script.getAttribute('data-color') : '#0071e3'
  var TITLE = script.getAttribute('data-title') || 'Chat with us'
  var LEFT = script.getAttribute('data-position') === 'left'
  var STORE = 'vc-widget:' + AGENT

  var state = { token: null, expires: 0, conv: null, lines: [], agent: null, busy: false }
  try { var saved = JSON.parse(sessionStorage.getItem(STORE) || 'null'); if (saved) { state.conv = saved.conv; state.lines = saved.lines || [] } } catch (e) {}
  function persist() { try { sessionStorage.setItem(STORE, JSON.stringify({ conv: state.conv, lines: state.lines.slice(-50) })) } catch (e) {} }

  // ---------- DOM ----------
  var host = document.createElement('div')
  host.setAttribute('data-vc-widget', '')
  var root = host.attachShadow({ mode: 'open' })
  var side = LEFT ? 'left' : 'right'
  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Tamil","Noto Sans Devanagari",sans-serif}' +
    '.launch{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:' + COLOR + ';color:#fff;box-shadow:0 10px 30px -8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:transform .2s}' +
    '.launch:hover{transform:scale(1.06)}.launch:focus-visible{outline:3px solid #fff;outline-offset:2px}' +
    '.panel{position:fixed;bottom:88px;' + side + ':20px;z-index:2147483000;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;color:#1d1d1f;border-radius:20px;box-shadow:0 24px 60px -12px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden}' +
    '.panel.open{display:flex}' +
    '.head{padding:14px 16px;background:' + COLOR + ';color:#fff;display:flex;align-items:center;gap:10px}' +
    '.head .t{flex:1;min-width:0}.head .n{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.head .s{font-size:12px;opacity:.85}' +
    '.icon{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:10px;height:30px;padding:0 10px;font-size:12px;cursor:pointer}' +
    '.icon:hover{background:rgba(255,255,255,.3)}' +
    '.msgs{flex:1;overflow-y:auto;padding:14px;background:#f5f5f7;display:flex;flex-direction:column;gap:8px}' +
    '.b{max-width:82%;padding:9px 12px;border-radius:16px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}' +
    '.agent{align-self:flex-start;background:#fff;border:1px solid rgba(0,0,0,.06)}' +
    '.user{align-self:flex-end;background:' + COLOR + ';color:#fff}' +
    '.sys{align-self:center;font-size:12px;color:#b4232c;text-align:center}' +
    '.typing{align-self:flex-start;font-size:12px;color:#86868b}' +
    'form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e5ea;background:#fff}' +
    'input{flex:1;border:1px solid #d2d2d7;border-radius:12px;padding:10px 12px;font-size:14px;outline:none;color:#1d1d1f;background:#fff}' +
    'input:focus{border-color:' + COLOR + '}' +
    'button.send{border:0;border-radius:12px;padding:0 14px;background:' + COLOR + ';color:#fff;font-size:14px;cursor:pointer}' +
    'button.send:disabled{opacity:.5;cursor:default}' +
    '.foot{font-size:10.5px;color:#86868b;text-align:center;padding:0 10px 8px;background:#fff}' +
    '@media (max-width:480px){.panel{' + side + ':12px;bottom:80px;height:calc(100vh - 100px)}}' +
    '</style>' +
    '<button class="launch" aria-label="' + attr(TITLE) + '" aria-expanded="false">' +
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg></button>' +
    '<div class="panel" role="dialog" aria-label="' + attr(TITLE) + '">' +
    '<div class="head"><div class="t"><div class="n"></div><div class="s">Usually replies instantly</div></div>' +
    '<button class="icon new" type="button">New chat</button><button class="icon close" type="button" aria-label="Close chat">✕</button></div>' +
    '<div class="msgs" aria-live="polite"></div>' +
    '<form><input type="text" maxlength="2000" placeholder="Type your message…" aria-label="Message"><button class="send" type="submit">Send</button></form>' +
    '<div class="foot">AI assistant · it can make mistakes</div></div>'

  function attr(s) { return String(s).replace(/[&"<>]/g, function (c) { return { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c] }) }
  var $ = function (sel) { return root.querySelector(sel) }
  var launch = $('.launch'), panel = $('.panel'), msgs = $('.msgs'), form = $('form'), input = $('input'), send = $('.send')
  $('.n').textContent = TITLE

  function render() {
    msgs.textContent = ''
    state.lines.forEach(function (l) {
      var d = document.createElement('div')
      d.className = l.role === 'user' ? 'b user' : l.role === 'agent' ? 'b agent' : 'sys'
      d.textContent = l.text
      msgs.appendChild(d)
    })
    if (state.busy) { var t = document.createElement('div'); t.className = 'typing'; t.textContent = 'Typing…'; msgs.appendChild(t) }
    msgs.scrollTop = msgs.scrollHeight
    send.disabled = state.busy
  }
  function add(role, text) { state.lines.push({ role: role, text: text }); if (role !== 'sys') persist(); render() }

  // ---------- API ----------
  function post(path, body, auth) {
    var headers = { 'Content-Type': 'application/json' }
    if (auth) headers.Authorization = 'Bearer ' + state.token
    return fetch(BASE + path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) { if (!r.ok) { var e = new Error(j.detail || 'HTTP ' + r.status); e.status = r.status; throw e } return j })
    })
  }
  function ensureSession() {
    if (state.token && Date.now() < state.expires - 30000) return Promise.resolve()
    return post('/agents/' + encodeURIComponent(AGENT) + '/session').then(function (s) {
      state.token = s.token
      state.expires = Date.now() + (s.expires_in || 900) * 1000
      state.agent = s.agent
      if (s.agent && s.agent.business) $('.n').textContent = s.agent.business
    })
  }
  function start() {
    ensureSession().then(function () {
      if (!state.lines.length && state.agent && state.agent.greeting) add('agent', state.agent.greeting)
    }).catch(function () { add('sys', 'Chat is unavailable right now.') })
  }
  function ask(text, retried) {
    state.busy = true; render()
    return ensureSession()
      .then(function () { return post('/chat', { text: text, conversation_id: state.conv }, true) })
      .then(function (r) { state.conv = r.conversation_id; state.busy = false; add('agent', r.reply) })
      .catch(function (e) {
        if (e.status === 401 && !retried) { state.token = null; return ask(text, true) } // session expired: renew once
        if (e.status === 404 && state.conv && !retried) { state.conv = null; return ask(text, true) } // old chat ended
        state.busy = false
        add('sys', e.status === 429 ? 'Too many messages. Please wait a moment.' : 'Sorry, something went wrong. Please try again.')
      })
  }

  // ---------- events ----------
  function toggle(open) {
    panel.classList.toggle('open', open)
    launch.setAttribute('aria-expanded', String(open))
    if (open) { start(); render(); setTimeout(function () { input.focus() }, 50) } else launch.focus()
  }
  launch.addEventListener('click', function () { toggle(!panel.classList.contains('open')) })
  $('.close').addEventListener('click', function () { toggle(false) })
  root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) toggle(false) })
  $('.new').addEventListener('click', function () {
    if (state.conv && state.token) post('/chat/' + encodeURIComponent(state.conv) + '/end', {}, true).catch(function () {})
    state.conv = null; state.lines = []; persist(); start(); render(); input.focus()
  })
  form.addEventListener('submit', function (e) {
    e.preventDefault()
    var text = input.value.trim()
    if (!text || state.busy) return
    input.value = ''
    add('user', text)
    ask(text)
  })

  ;(document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r) }))
    .then(function () { document.body.appendChild(host) })
})()
