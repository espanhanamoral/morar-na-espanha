/* Painel administrativo — lê os dados pelo Supabase com o login do administrador.
   As regras de segurança (RLS) no banco garantem que só e-mails em public.administradores veem algo. */
(function () {
  "use strict";
  var C = window.EM_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var sb = (C.SUPABASE_URL && C.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: "em-admin" } })
    : (window.__SB_MOCK__ || null);
  var dias = 30, leads = [], eventos = [];
  var SIT = { quero_morar: "Quer morar", ja_moro: "Já mora", pesquisando: "Pesquisando" };

  if (!sb) { document.body.innerHTML = '<div class="login"><div class="aviso-cfg">Preencha <b>SUPABASE_URL</b> e <b>SUPABASE_ANON_KEY</b> em <code>config.js</code>.</div></div>'; return; }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tela(qual) { $("tela-login").style.display = qual === "login" ? "block" : "none"; $("tela-painel").style.display = qual === "painel" ? "block" : "none"; }

  async function iniciar() {
    var s = await sb.auth.getSession();
    if (!s.data.session) return tela("login");
    var adm = await sb.rpc("e_admin");
    if (adm.error || adm.data !== true) { await sb.auth.signOut(); $("erro-login").textContent = "Este usuário não tem permissão de administrador."; return tela("login"); }
    tela("painel"); carregar();
  }

  $("f-login").addEventListener("submit", async function (e) {
    e.preventDefault(); $("erro-login").textContent = "";
    var r = await sb.auth.signInWithPassword({ email: $("l-email").value.trim(), password: $("l-senha").value });
    $("l-senha").value = "";
    if (r.error) { $("erro-login").textContent = "E-mail ou senha incorretos."; return; }
    iniciar();
  });
  $("sair").addEventListener("click", async function () { await sb.auth.signOut(); tela("login"); });
  $("atualizar").addEventListener("click", carregar);
  $("periodo").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    [].forEach.call(this.children, function (x) { x.classList.toggle("on", x === b); });
    dias = +b.dataset.d; render();
  });
  $("busca").addEventListener("input", renderContatos);
  $("so-mk").addEventListener("change", renderContatos);
  $("csv").addEventListener("click", exportarCSV);

  async function todos(tabela, colunas) { // pagina de 1000 em 1000 (limite padrão da API)
    var out = [], de = 0, passo = 1000;
    while (true) {
      var r = await sb.from(tabela).select(colunas).order("criado_em", { ascending: false }).range(de, de + passo - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data); if (r.data.length < passo) break; de += passo;
    }
    return out;
  }
  async function carregar() {
    try {
      leads = await todos("leads", "id,criado_em,atualizado_em,primeiro_nome,email,situacao,marketing_consentido,marketing_consentido_em,marketing_revogado_em,utm_source,utm_medium,utm_campaign,referencia,cadastros_repetidos");
      eventos = await todos("eventos", "criado_em,tipo,lead_id,utm_source,referencia");
      render();
    } catch (e) { alert("Erro ao carregar dados: " + (e.message || e)); }
  }

  function noPeriodo(d) { return !dias || (Date.now() - new Date(d).getTime()) <= dias * 864e5; }
  function origemDe(x) { return x.utm_source || x.referencia || "direto / desconhecida"; }
  function fmt(n) { return n.toLocaleString("pt-BR"); }

  function render() {
    var L = leads.filter(function (l) { return noPeriodo(l.criado_em); });
    var E = eventos.filter(function (e) { return noPeriodo(e.criado_em); });
    var visitas = E.filter(function (e) { return e.tipo === "visita"; });
    var uniq = function (tipo) { var s = {}; E.forEach(function (e) { if (e.tipo === tipo && e.lead_id) s[e.lead_id] = 1; }); return Object.keys(s).length; };
    var mk = L.filter(function (l) { return l.marketing_consentido; }).length;
    $("k-visitas").textContent = fmt(visitas.length);
    $("k-cadastros").textContent = fmt(L.length);
    $("k-conv").textContent = visitas.length ? (L.length / visitas.length * 100).toFixed(1).replace(".", ",") + "%" : "–";
    $("k-cliques").textContent = fmt(uniq("clique_download"));
    $("k-down").textContent = fmt(uniq("download_concluido"));
    $("k-mk").textContent = fmt(mk);
    $("k-mk-p").textContent = L.length ? Math.round(mk / L.length * 100) + "% dos cadastros" : "Consentimento de marketing";
    grafico(L, visitas); origens(L, visitas); renderContatos();
  }

  function grafico(L, V) {
    var n = dias || Math.max(7, Math.ceil((Date.now() - Math.min.apply(null, leads.map(function (l) { return +new Date(l.criado_em); }).concat([Date.now()]))) / 864e5) + 1);
    n = Math.min(n, 120);
    var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    var chaves = [], cad = {}, vis = {};
    for (var i = n - 1; i >= 0; i--) { var d = new Date(hoje - i * 864e5); var k = d.toISOString().slice(0, 10); chaves.push(k); cad[k] = 0; vis[k] = 0; }
    var dia = function (x) { var d = new Date(x); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 10); };
    L.forEach(function (l) { var k = dia(l.criado_em); if (k in cad) cad[k]++; });
    V.forEach(function (v) { var k = dia(v.criado_em); if (k in vis) vis[k]++; });
    var max = Math.max(1, Math.max.apply(null, chaves.map(function (k) { return Math.max(cad[k], vis[k]); })));
    var W = 700, H = 220, p = 28, bw = (W - p * 2) / chaves.length;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    for (var g = 0; g <= 4; g++) { var y = H - p - (H - p * 2) * g / 4; s += '<line x1="' + p + '" x2="' + (W - 6) + '" y1="' + y + '" y2="' + y + '" stroke="#EFE7DD"/><text x="2" y="' + (y + 4) + '" font-size="10" fill="#6E675F">' + Math.round(max * g / 4) + '</text>'; }
    var linha = chaves.map(function (k, i) { return (p + bw * i + bw / 2) + "," + (H - p - (H - p * 2) * vis[k] / max); }).join(" ");
    chaves.forEach(function (k, i) {
      var h = (H - p * 2) * cad[k] / max, x = p + bw * i + bw * .18;
      s += '<rect x="' + x + '" y="' + (H - p - h) + '" width="' + Math.max(1, bw * .64) + '" height="' + h + '" fill="#AF0B10" rx="2"><title>' + k + ': ' + cad[k] + ' cadastros, ' + vis[k] + ' visitas</title></rect>';
      if (chaves.length <= 31 && (i % Math.ceil(chaves.length / 8) === 0)) s += '<text x="' + (p + bw * i + bw / 2) + '" y="' + (H - 8) + '" font-size="10" text-anchor="middle" fill="#6E675F">' + k.slice(8) + '/' + k.slice(5, 7) + '</text>';
    });
    s += '<polyline points="' + linha + '" fill="none" stroke="#F8B706" stroke-width="2.5"/></svg>';
    $("grafico").outerHTML = s.replace("<svg ", '<svg class="graf" id="grafico" role="img" aria-label="Cadastros e visitas por dia" ');
  }

  function origens(L, V) {
    var m = {};
    V.forEach(function (v) { var k = origemDe(v); (m[k] = m[k] || { v: 0, c: 0 }).v++; });
    L.forEach(function (l) { var k = origemDe(l); (m[k] = m[k] || { v: 0, c: 0 }).c++; });
    var linhas = Object.keys(m).sort(function (a, b) { return m[b].c - m[a].c || m[b].v - m[a].v; });
    $("t-origem").tBodies[0].innerHTML = linhas.length ? linhas.map(function (k) { return "<tr><td>" + esc(k) + "</td><td>" + m[k].v + "</td><td><b>" + m[k].c + "</b></td></tr>"; }).join("") : '<tr><td colspan="3">Sem dados no período.</td></tr>';
  }

  function filtrados() {
    var q = $("busca").value.trim().toLowerCase(), so = $("so-mk").checked;
    return leads.filter(function (l) {
      return noPeriodo(l.criado_em) && (!so || l.marketing_consentido) &&
        (!q || (l.primeiro_nome + " " + l.email).toLowerCase().indexOf(q) >= 0);
    });
  }
  function flags() {
    var c = {}, d = {};
    eventos.forEach(function (e) { if (e.lead_id) { if (e.tipo === "clique_download") c[e.lead_id] = 1; if (e.tipo === "download_concluido") d[e.lead_id] = 1; } });
    return { c: c, d: d };
  }
  function renderContatos() {
    var F = filtrados(), fl = flags();
    var tag = function (b) { return '<span class="tag ' + (b ? "sim" : "nao") + '">' + (b ? "Sim" : "Não") + "</span>"; };
    $("t-contatos").tBodies[0].innerHTML = F.slice(0, 500).map(function (l) {
      return "<tr><td>" + new Date(l.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + "</td><td>" + esc(l.primeiro_nome) + "</td><td>" + esc(l.email) +
        "</td><td>" + esc(SIT[l.situacao] || "—") + "</td><td>" + esc(origemDe(l)) + "</td><td>" + tag(l.marketing_consentido) + "</td><td>" + tag(fl.c[l.id]) + "</td><td>" + tag(fl.d[l.id]) +
        '</td><td style="white-space:nowrap">' + (l.marketing_consentido ? '<button class="bt claro mini" data-rev="' + l.id + '">Retirar consentimento</button> ' : "") +
        '<button class="bt perigo mini" data-del="' + l.id + '">Apagar</button></td></tr>';
    }).join("") || '<tr><td colspan="9">Nenhum contato.</td></tr>';
    $("contagem").textContent = F.length + " contato(s) no filtro" + (F.length > 500 ? " (mostrando 500; o CSV inclui todos)" : "") + ".";
  }

  // ações: retirar consentimento e apagar (direitos do titular)
  var acao = null;
  $("t-contatos").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var id = b.dataset.del || b.dataset.rev, l = leads.find(function (x) { return x.id === id; }); if (!l) return;
    if (b.dataset.del) confirmar("Apagar contato", "Apagar definitivamente " + l.email + " e todos os registros de download dessa pessoa? Não é possível desfazer.", async function () {
      var r = await sb.from("leads").delete().eq("id", id); if (r.error) return alert(r.error.message); carregar(); });
    else confirmar("Retirar consentimento", l.email + " deixará de constar como autorizado a receber novidades.", async function () {
      var r = await sb.from("leads").update({ marketing_consentido: false, marketing_revogado_em: new Date().toISOString() }).eq("id", id); if (r.error) return alert(r.error.message); carregar(); });
  });
  function confirmar(t, txt, fn) { $("m-tit").textContent = t; $("m-txt").textContent = txt; acao = fn; $("modal").classList.add("on"); }
  $("m-nao").addEventListener("click", function () { $("modal").classList.remove("on"); });
  $("m-sim").addEventListener("click", function () { $("modal").classList.remove("on"); if (acao) acao(); });

  function exportarCSV() {
    var F = filtrados(), fl = flags();
    var cab = ["data_cadastro", "primeiro_nome", "email", "situacao", "origem", "utm_campaign", "aceitou_novidades", "consentimento_em", "clicou_download", "download_confirmado"];
    var cel = function (v) { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    var linhas = F.map(function (l) { return [l.criado_em, l.primeiro_nome, l.email, SIT[l.situacao] || "", origemDe(l), l.utm_campaign || "", l.marketing_consentido ? "sim" : "nao", l.marketing_consentido_em || "", fl.c[l.id] ? "sim" : "nao", fl.d[l.id] ? "sim" : "nao"].map(cel).join(";"); });
    var blob = new Blob(["﻿" + cab.join(";") + "\n" + linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "contatos-ebook" + ($("so-mk").checked ? "-com-consentimento" : "") + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  iniciar();
})();
