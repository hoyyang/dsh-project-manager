window.__ModuleLoader__.load({
	id: "dsh-project-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/api.ts
		/** 与 host 路由通信（同源 fetch；错误抛出带 code 的 ApiError，由界面点名展示）。 */
		const API = "/_dsh/dsh-project-manager/api";
		var ApiError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.code = code;
				this.name = "ApiError";
			}
		};
		async function call(path, init) {
			let res;
			try {
				res = await fetch(API + path, init);
			} catch (e) {
				throw new ApiError("NETWORK", "无法连接 dsh-project-manager 服务：" + String(e));
			}
			let body;
			try {
				body = await res.json();
			} catch {
				throw new ApiError("BAD_RESPONSE", "dsh-project-manager 返回了非 JSON（HTTP " + res.status + "）");
			}
			if (!body.ok) throw new ApiError(body.error?.code ?? "HTTP_" + res.status, body.error?.message ?? "请求失败");
			return body;
		}
		const getState = (since) => call("/state" + (since !== void 0 ? "?since=" + since : ""));
		const getSession = (id) => call("/session?id=" + encodeURIComponent(id));
		const post = (action, body) => call(action.startsWith("/") ? action : "/" + action, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body)
		});
		//#endregion
		//#region src/client/icons.ts
		/** 内联 SVG 图标（线性 1.8px，与原型一致）；看板按钮图标为实心三列（dsh-image-gen 设计稿方案 A 定稿）。 */
		const P = {
			search: "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/>",
			plus: "<path d=\"M12 5v14M5 12h14\"/>",
			import: "<path d=\"M12 3v12m0 0-4-4m4 4 4-4\"/><path d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2\"/>",
			chev: "<path d=\"m6 9 6 6 6-6\"/>",
			check: "<path d=\"m5 12 5 5 9-10\"/>",
			x: "<path d=\"M6 6l12 12M18 6 6 18\"/>",
			fplus: "<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z\"/><path d=\"M12 10v6M9 13h6\"/>",
			link: "<path d=\"M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5\"/><path d=\"M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5\"/>",
			unlink: "<path d=\"m18.8 13.4 1.3-1.3a4 4 0 0 0-5.7-5.7l-1.3 1.3\"/><path d=\"m5.2 10.6-1.3 1.3a4 4 0 0 0 5.7 5.7l1.3-1.3\"/><path d=\"M8 2v3M2 8h3M16 22v-3M22 16h-3\"/>",
			restore: "<path d=\"M3 12a9 9 0 1 0 3-6.7L3 8\"/><path d=\"M3 3v5h5\"/>",
			folder: "<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z\"/>",
			pencil: "<path d=\"M4 20h4L19 9l-4-4L4 16Z\"/><path d=\"m13.5 6.5 4 4\"/>",
			play: "<path d=\"M7 5v14l11-7Z\"/>",
			sliders: "<path d=\"M4 7h10M18 7h2M4 17h4M12 17h8\"/><circle cx=\"16\" cy=\"7\" r=\"2\"/><circle cx=\"10\" cy=\"17\" r=\"2\"/>",
			shield: "<path d=\"M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z\"/>",
			repo: "<path d=\"M6 3h11a1 1 0 0 1 1 1v14H7a2 2 0 0 0-2 2V5a2 2 0 0 1 1-2Z\"/><path d=\"M5 20a2 2 0 0 0 2 2h11v-4\"/>",
			arrow: "<path d=\"M5 12h14m-5-5 5 5-5 5\"/>",
			sun: "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/>",
			moon: "<path d=\"M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z\"/>",
			mem: "<path d=\"M6 4h9l3 3v13H6Z\"/><path d=\"M15 4v3h3M9 11h6M9 15h4\"/>",
			trash: "<path d=\"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3\"/>",
			refresh: "<path d=\"M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5\"/>"
		};
		const ic = (id) => "<svg class=\"i\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">" + (P[id] ?? "") + "</svg>";
		const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			"\"": "&quot;",
			"'": "&#39;"
		})[c]);
		//#endregion
		//#region src/client/board.ts
		/**
		* 项目看板（主区面板）：vanilla DOM 渲染，直接移植原型 v8 的结构/样式/交互；数据全部来自 host 快照。
		* 阶段（statuses）只用来给卡片分组；每个阶段底部常驻「添加卡片」，就地输入、回车连续添加。
		* 所有变更 → POST → 用返回的新快照重绘（服务端是唯一事实来源，失败时点名提示并回到服务端状态）。
		*/
		/** 相对时间：刚刚 / N分钟 / N小时 / N天（与侧栏一致的粒度）。 */
		const ago = (t, now = Date.now()) => {
			const m = Math.max(0, Math.floor((now - t) / 6e4));
			return m < 1 ? "刚刚" : m < 60 ? m + "分钟" : m < 1440 ? Math.floor(m / 60) + "小时" : Math.floor(m / 1440) + "天";
		};
		/**
		* 候选会话按仓库分组：组内新→旧；组按组内最新会话排序（最新的组在前）。
		* 过滤掉本卡片已关联的和已选的；q 匹配会话名或仓库名。
		*/
		function groupSessions(list, opts) {
			const q = opts.q.trim().toLowerCase();
			const pool = list.filter((s) => s.archived === opts.archived && !opts.exclude.has(s.id) && (!q || (s.title + " " + s.ws).toLowerCase().includes(q)));
			pool.sort((a, b) => b.updatedAt - a.updatedAt);
			const by = /* @__PURE__ */ new Map();
			for (const s of pool) {
				const k = s.ws;
				if (!by.has(k)) by.set(k, []);
				by.get(k).push(s);
			}
			return [...by.entries()];
		}
		/** 与 dsh 添加工作区的默认标题同一规则：去掉末尾分隔符，取最后一段。 */
		const folderName = (p) => {
			const t = p.replace(/[/\\]+$/, "");
			return t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1);
		};
		const normPath = (p) => p.replace(/[/\\]+$/, "") || "/";
		var BoardView = class {
			root;
			host;
			snap = null;
			sel = null;
			q = "";
			err = "";
			editG = null;
			timer = null;
			dragId = null;
			dropAt = null;
			link = null;
			disposers = [];
			disposed = false;
			/** 正在就地添加卡片的阶段；addDraft 跨重绘保留输入。 */
			adding = null;
			addDraft = "";
			addBusy = false;
			rendering = false;
			composing = false;
			/** 「添加挂载仓库」弹窗的草稿：候选搜索词、已选项、是否降级为手输路径。 */
			ar = null;
			/** 「关联已有会话」弹窗草稿；cf = 待确认解除关联的会话。 */
			ls = null;
			cf = null;
			restoring = /* @__PURE__ */ new Set();
			constructor(root, host) {
				this.root = root;
				this.host = host;
				root.classList.add("dpm");
				root.innerHTML = "<div class=\"pm-top\"></div><div class=\"pm-body\"><div class=\"board-wrap\"></div></div>" + DIALOGS.replace("%FOLDER%", ic("fplus"));
				this.bind();
				this.refresh();
				this.timer = setInterval(() => {
					if (!document.hidden) this.refresh(true);
				}, 4e3);
			}
			dispose() {
				this.disposed = true;
				if (this.timer) clearInterval(this.timer);
				for (const d of this.disposers) d();
				this.root.innerHTML = "";
			}
			get groups() {
				return this.snap?.board.groups ?? [];
			}
			get cards() {
				return this.snap?.board.cards ?? [];
			}
			grp(id) {
				return this.groups.find((g) => g.id === id);
			}
			card(id) {
				return this.cards.find((c) => c.id === id);
			}
			st(g, id) {
				return g.statuses.find((s) => s.id === id);
			}
			stateOf(k) {
				return this.snap?.states.find((s) => s.key === k);
			}
			memOf(c) {
				const out = (this.grp(c.g)?.links ?? []).map((k) => ({
					k,
					from: "group"
				}));
				for (const k of c.links) {
					const hit = out.find((x) => x.k === k);
					if (hit) hit.from = "both";
					else out.push({
						k,
						from: "card"
					});
				}
				return out;
			}
			cardDesc(c) {
				const m = this.memOf(c);
				const own = m.find((x) => x.from !== "group") ?? m[0];
				const s = own ? this.stateOf(own.k) : void 0;
				return s ? s.status || "暂无状态说明" : m.length ? "关联的落盘项目未找到" : "未关联落盘项目";
			}
			cell(g, col) {
				return this.cards.filter((c) => c.g === g && c.col === col).sort((a, b) => a.order - b.order);
			}
			sessionsOf(cardId) {
				return (this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId).map((s) => ({
					id: s.sessionId,
					title: s.title ?? "会话 " + s.sessionId.slice(0, 8),
					at: s.createdAt.slice(5, 16).replace("T", " ")
				}));
			}
			async refresh(quiet = false) {
				try {
					if (quiet && this.composing) return;
					const r = await getState(quiet && this.snap ? this.snap.rev : void 0);
					if (this.disposed || r.same) return;
					this.snap = r;
					this.err = "";
					this.render();
				} catch (e) {
					this.err = e instanceof Error ? e.message : String(e);
					this.render();
				}
			}
			async act(action, body, okMsg) {
				try {
					const r = await post(action, body);
					if (this.disposed) return true;
					this.snap = r;
					this.render();
					if (okMsg) this.host.toast(okMsg);
					return true;
				} catch (e) {
					this.host.toast(e instanceof ApiError ? e.message : String(e), "err");
					await this.refresh();
					return false;
				}
			}
			render() {
				if (this.disposed) return;
				const dark = this.host.isDark();
				const top = this.root.querySelector(".pm-top");
				if (!top.firstChild) top.innerHTML = "<div class=\"ttl\"><h1>项目看板</h1><p>一张卡片对应一个落盘项目，卡片组就是父项目。每个卡片组有自己的一套阶段。</p></div><label class=\"search\">" + ic("search") + "<span class=\"sr-only\">搜索卡片</span><input id=\"dpmQ\" type=\"search\" placeholder=\"搜索卡片或仓库\" value=\"" + esc(this.q) + "\"></label><button type=\"button\" class=\"btn\" data-import>" + ic("import") + "导入落盘项目</button><button type=\"button\" class=\"btn primary\" data-new-group>" + ic("plus") + "新建卡片组</button><button type=\"button\" class=\"ib\" data-theme-toggle></button>";
				const tb = top.querySelector("[data-theme-toggle]");
				const want = dark ? "sun" : "moon";
				if (tb.dataset.icon !== want) {
					tb.dataset.icon = want;
					tb.innerHTML = ic(want);
					tb.setAttribute("aria-label", "切换到" + (dark ? "浅色" : "深色") + "主题");
				}
				const body = this.root.querySelector(".pm-body");
				const wrap = body.querySelector(".board-wrap");
				const scroll = wrap.scrollTop;
				const addFocus = document.activeElement?.id === "dpmAddIn";
				this.rendering = true;
				const laneX = /* @__PURE__ */ new Map();
				wrap.querySelectorAll(".lane-in[data-g]").forEach((el) => laneX.set(el.dataset.g, el.scrollLeft));
				wrap.innerHTML = (this.err ? "<div class=\"dpm-err\" role=\"alert\">" + esc(this.err) + "</div>" : "") + this.boardHtml();
				wrap.scrollTop = scroll;
				wrap.querySelectorAll(".lane-in[data-g]").forEach((el) => {
					const x = laneX.get(el.dataset.g);
					if (x) el.scrollLeft = x;
				});
				const addIn = wrap.querySelector("#dpmAddIn");
				if (!addIn) this.adding = null;
				else if (addFocus) {
					addIn.focus();
					addIn.setSelectionRange(addIn.value.length, addIn.value.length);
				}
				const old = body.querySelector(".detail");
				const keep = old ? {
					scroll: old.querySelector(".d-b")?.scrollTop ?? 0,
					task: old.querySelector("#dpmNewTask")?.value ?? "",
					focus: document.activeElement?.id === "dpmNewTask",
					same: old.getAttribute("data-card") === this.sel
				} : null;
				old?.remove();
				if (this.sel && this.card(this.sel)) {
					body.insertAdjacentHTML("beforeend", this.detailHtml());
					if (keep?.same) {
						const nd = body.querySelector(".detail");
						const db = nd.querySelector(".d-b");
						if (db) db.scrollTop = keep.scroll;
						const inp = nd.querySelector("#dpmNewTask");
						if (inp && keep.task) inp.value = keep.task;
						if (inp && keep.focus) inp.focus();
					}
				} else this.sel = null;
				this.rendering = false;
			}
			boardHtml() {
				if (!this.snap) return "<div class=\"empty-board\"><span>加载中…</span></div>";
				if (!this.groups.length) return "<div class=\"empty-board\"><b>还没有卡片组</b><span>新建一个卡片组，或从落盘项目导入。</span><button type=\"button\" class=\"btn primary\" data-new-group>" + ic("plus") + "新建卡片组</button></div>";
				const q = this.q;
				const vis = this.cards.filter((c) => !q || (c.t + " " + c.links.join(" ") + " " + this.cardDesc(c) + " " + (this.grp(c.g)?.repos.map((r) => r.name).join(" ") ?? "")).toLowerCase().includes(q));
				return this.groups.map((g) => {
					const cs = vis.filter((c) => c.g === g.id);
					const n = g.statuses.length;
					const head = "<div class=\"shead\" style=\"--cols:" + n + "\">" + g.statuses.map((st) => "<div class=\"colh\"><span class=\"nm\">" + esc(st.name) + "</span><span class=\"n\">" + cs.filter((x) => x.col === st.id).length + "</span></div>").join("") + "</div>";
					const bodyHtml = g.statuses.map((st) => {
						const inCol = cs.filter((c) => c.col === st.id).sort((a, b) => a.order - b.order);
						return "<div class=\"cell" + (inCol.length ? "" : " empty") + "\" data-col=\"" + esc(st.id) + "\" data-g=\"" + esc(g.id) + "\">" + inCol.map((c) => this.cardHtml(c)).join("") + this.addHtml(g, st) + "</div>";
					}).join("");
					return "<section class=\"lane" + (g.collapsed ? " collapsed" : "") + "\"><div class=\"lane-h\"><button type=\"button\" class=\"ib\" data-toggle=\"" + esc(g.id) + "\" aria-expanded=\"" + !g.collapsed + "\" aria-label=\"" + (g.collapsed ? "展开 " : "折叠 ") + esc(g.name) + "\"><svg class=\"i chev\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m6 9 6 6 6-6\"/></svg></button><h2>" + esc(g.name) + "</h2><span class=\"meta\">" + g.repos.length + " 个仓库 · " + cs.length + " 张卡片 · " + n + " 个阶段</span>" + (g.links.length ? "<button type=\"button\" class=\"chip mem as-btn\" data-edit-group=\"" + esc(g.id) + "\" data-focus-links>" + ic("mem") + "组记忆 " + g.links.length + "</button>" : "") + "<span class=\"sp\"></span><button type=\"button\" class=\"btn ghost\" data-edit-group=\"" + esc(g.id) + "\">" + ic("sliders") + "卡片组设置</button><button type=\"button\" class=\"btn ghost\" data-new-in=\"" + esc(g.id) + "\">" + ic("plus") + "新会话</button></div><div class=\"lane-in\" data-g=\"" + esc(g.id) + "\">" + head + "<div class=\"lane-b\" style=\"--cols:" + n + "\">" + bodyHtml + "</div></div></section>";
				}).join("");
			}
			/** 阶段底部的「添加卡片」：按钮，或正在输入时的就地表单。 */
			addHtml(g, st) {
				const a = this.adding;
				if (a && a.g === g.id && a.col === st.id) return "<form class=\"addc-f\" data-addcard><label class=\"sr-only\" for=\"dpmAddIn\">在「" + esc(st.name) + "」添加卡片</label><input id=\"dpmAddIn\" placeholder=\"卡片标题，回车添加\" autocomplete=\"off\" maxlength=\"120\" value=\"" + esc(this.addDraft) + "\"><span class=\"hint\">回车添加，可连续输入 · Esc 收起</span></form>";
				return "<button type=\"button\" class=\"addc\" data-add-card=\"" + esc(g.id) + "\" data-col=\"" + esc(st.id) + "\" aria-label=\"在「" + esc(st.name) + "」添加卡片\">" + ic("plus") + "添加卡片</button>";
			}
			cardHtml(c) {
				const done = c.tasks.filter((t) => t.done).length;
				const pct = c.tasks.length ? Math.round(done / c.tasks.length * 100) : 0;
				const prog = c.tasks.length ? "<span class=\"prog\"><span class=\"bar\"><i style=\"width:" + pct + "%\"></i></span>" + done + "/" + c.tasks.length + "</span>" : "<span class=\"meta\">无子任务</span>";
				const n = this.memOf(c).length;
				const mem = n ? "<span class=\"chip mem\" title=\"会话会自动读取 " + n + " 个落盘项目的记忆\">" + ic("mem") + n + "</span>" : "<span class=\"chip warn\" title=\"没有关联落盘项目，会话不会读取任何记忆\">" + ic("mem") + "0</span>";
				return "<div class=\"card\" role=\"button\" tabindex=\"0\" draggable=\"true\" data-card=\"" + esc(c.id) + "\" aria-pressed=\"" + (this.sel === c.id) + "\" aria-label=\"" + esc(c.t) + "，打开详情；Alt+上下方向键调整顺序\"><h3>" + esc(c.t) + "</h3><p>" + esc(this.cardDesc(c)) + "</p><div class=\"foot\">" + prog + mem + "</div></div>";
			}
			detailHtml() {
				const c = this.card(this.sel);
				const g = this.grp(c.g);
				const sts = g.statuses;
				const i = sts.findIndex((x) => x.id === c.col);
				const nx = sts[i + 1];
				const steps = sts.map((s, k) => "<button type=\"button\" class=\"step" + (k < i ? " past" : k === i ? " cur" : "") + "\" data-step=\"" + esc(s.id) + "\"" + (k === i ? " aria-current=\"step\"" : "") + " aria-label=\"移到 " + esc(s.name) + "\"><span class=\"nd\">" + (k < i ? ic("check") : "") + "</span>" + esc(s.name) + "</button>").join("");
				const mem = this.memOf(c);
				const memRows = mem.map((m) => {
					const s = this.stateOf(m.k);
					const tag = m.from === "group" ? "<span class=\"chip plain\">来自卡片组</span>" : m.from === "both" ? "<span class=\"chip plain\">卡片组 + 卡片</span>" : "<span class=\"chip brand\">卡片</span>";
					const rm = m.from !== "group" ? "<button type=\"button\" class=\"ib\" data-unlink-card=\"" + esc(m.k) + "\" aria-label=\"取消关联 " + esc(m.k) + "\">" + ic("x") + "</button>" : "";
					if (!s) return "<div class=\"mrow\"><div class=\"txt\"><div class=\"nm\">" + esc(m.k) + "</div><p class=\"l\">未找到这个落盘项目的 STATE（可能已移动或删除）</p></div><div class=\"mside\">" + tag + rm + "</div></div>";
					return "<div class=\"mrow\"><div class=\"txt\"><div class=\"nm\">" + esc(s.slug) + "</div><span class=\"mono\">" + esc(s.project) + " · 更新于 " + esc(s.updated) + "</span><p class=\"l\">" + esc(s.status || "暂无状态说明") + "</p><p class=\"nx\"><b>next_action</b>" + esc(s.next || "暂无下一步") + "</p></div><div class=\"mside\">" + tag + rm + "</div></div>";
				}).join("") || "<p class=\"meta\">还没有关联落盘项目。会话不会自动读取任何记忆。</p>";
				const repos = g.repos.map((r) => "<div class=\"repo\">" + ic("repo") + "<div class=\"txt\"><div class=\"nm\">" + esc(r.name) + "</div><span class=\"mono\">" + esc(r.path) + "</span></div><span class=\"chip " + (r.role === "主仓" ? "brand" : "plain") + "\">" + esc(r.role) + "</span></div>").join("") || "<p class=\"meta\">未挂载仓库，在「卡片组设置」里添加。</p>";
				const tasks = c.tasks.map((t, k) => "<div class=\"task" + (t.done ? " done" : "") + "\"><label><input type=\"checkbox\" data-task=\"" + k + "\"" + (t.done ? " checked" : "") + "><span>" + esc(t.text) + "</span></label><button type=\"button\" class=\"ib sm\" data-task-del=\"" + k + "\" aria-label=\"删除子任务 " + esc(t.text) + "\">" + ic("x") + "</button></div>").join("");
				const sess = this.linkedHtml(c);
				return "<aside class=\"detail\" data-card=\"" + esc(c.id) + "\" aria-labelledby=\"dpmDT\"><div class=\"d-h\"><div class=\"grow\" style=\"white-space:normal\"><h2 id=\"dpmDT\">" + esc(c.t) + "</h2><div class=\"sub\">" + esc(g.name) + " · " + esc(sts[i]?.name ?? "") + "</div></div><button type=\"button\" class=\"ib\" data-rename-card aria-label=\"重命名卡片\">" + ic("pencil") + "</button><button type=\"button\" class=\"ib\" data-close aria-label=\"关闭详情\">" + ic("x") + "</button></div><div class=\"d-b\"><section class=\"sec\"><h3>" + ic("mem") + "关联的落盘项目 · " + mem.length + "<span class=\"grow\"></span><button type=\"button\" class=\"btn ghost sm\" data-link-card>" + ic("plus") + "关联</button></h3><p class=\"meta mb\">会话会自动读取下面这些落盘项目的记忆。来自卡片组的在「卡片组设置」里改。</p>" + memRows + "</section><section class=\"sec\"><h3>阶段</h3><div class=\"steps\">" + steps + "</div>" + (nx ? "<button type=\"button\" class=\"btn primary lg\" data-next>推进到 " + esc(nx.name) + ic("arrow") + "</button>" : "<p class=\"meta\">已在最后一个阶段</p>") + "</section><section class=\"sec\"><h3>" + ic("play") + "本卡片的会话 · " + this.sessionsOf(c.id).length + "<span class=\"grow\"></span><button type=\"button\" class=\"btn ghost sm\" data-link-sess>" + ic("link") + "关联已有会话</button></h3>" + sess + "</section><section class=\"sec\"><h3>子任务 " + c.tasks.filter((t) => t.done).length + "/" + c.tasks.length + "</h3>" + tasks + "<form class=\"addtask\" data-addtask><label class=\"sr-only\" for=\"dpmNewTask\">新子任务</label><input id=\"dpmNewTask\" placeholder=\"添加子任务，回车确认\" autocomplete=\"off\"><button class=\"btn\" type=\"submit\">添加</button></form></section><section class=\"sec\"><h3>" + ic("repo") + "仓库（继承自卡片组）</h3>" + repos + "</section><section class=\"sec\"><button type=\"button\" class=\"btn ghost danger\" data-remove-card>" + ic("trash") + "删除这张卡片</button></section></div><div class=\"d-f\"><div class=\"note\"><span class=\"chip warn\">" + ic("shield") + "完全权限</span><span class=\"chip mem\">" + ic("mem") + "自动读取 " + mem.length + " 个落盘项目</span></div><button type=\"button\" class=\"btn primary lg\" data-open-card>" + ic("play") + "以此卡片新建会话</button></div></aside>";
			}
			on(el, type, fn) {
				el.addEventListener(type, fn);
				this.disposers.push(() => el.removeEventListener(type, fn));
			}
			$(sel) {
				return this.root.querySelector(sel);
			}
			bind() {
				const r = this.root;
				this.on(r, "click", (e) => void this.onClick(e));
				this.on(r, "input", (e) => this.onInput(e));
				this.on(r, "compositionstart", () => {
					this.composing = true;
				});
				this.on(r, "compositionend", (e) => {
					this.composing = false;
					this.onInput(e);
				});
				this.on(r, "focusout", (e) => this.onFocusOut(e));
				this.on(r, "change", (e) => void this.onChange(e));
				this.on(r, "submit", (e) => void this.onSubmit(e));
				this.on(r, "keydown", (e) => void this.onKey(e));
				this.on(r, "dragstart", (e) => this.onDragStart(e));
				this.on(r, "dragover", (e) => this.onDragOver(e));
				this.on(r, "dragend", () => this.clearDrag());
				this.on(r, "drop", (e) => void this.onDrop(e));
				for (const id of [
					"dpmDlgSt",
					"dpmDlgName",
					"dpmDlgLink",
					"dpmDlgImp",
					"dpmDlgRepo",
					"dpmDlgSess",
					"dpmDlgCfm"
				]) {
					const d = this.$("#" + id);
					this.on(d, "close", () => void this.onDialogClose(id, d));
				}
			}
			async onClick(e) {
				const t = e.target.closest("button, [role=\"button\"]");
				if (!t || !this.root.contains(t)) return;
				const d = t.dataset;
				const c = this.sel ? this.card(this.sel) : void 0;
				if (d.dlgCancel !== void 0) {
					t.closest("dialog")?.close("cancel");
					return;
				}
				if (d.card) {
					this.sel = d.card;
					this.render();
					this.root.querySelector("[data-card=\"" + d.card + "\"]")?.scrollIntoView({
						block: "nearest",
						inline: "nearest",
						behavior: "smooth"
					});
					return;
				}
				if (d.close !== void 0) {
					this.sel = null;
					return this.render();
				}
				if (d.themeToggle !== void 0) {
					this.host.setDark(!this.host.isDark());
					return;
				}
				if (d.toggle) {
					const g = this.grp(d.toggle);
					if (g) await this.act("group/update", {
						id: g.id,
						collapsed: !g.collapsed
					});
					return;
				}
				if (d.newIn) return this.host.pickCard(t, d.newIn);
				if (d.openCard !== void 0 && c) return this.host.newSession(c.id);
				if (d.openSess) return this.host.openSession(d.openSess);
				if (d.linkSess !== void 0 && c) return this.openLinkSess(c);
				if (d.unbind) return this.askUnbind(d.unbind);
				if (d.restore) return this.restoreSession(d.restore);
				if (d.step && c) {
					await this.move(c, c.g, d.step, null);
					return;
				}
				if (d.next !== void 0 && c) {
					const sts = this.grp(c.g).statuses;
					const nx = sts[sts.findIndex((x) => x.id === c.col) + 1];
					if (nx) await this.move(c, c.g, nx.id, null);
					return;
				}
				if (d.newGroup !== void 0) return this.askName("新建卡片组", "卡片组就是父项目，默认带 5 个阶段，创建后可在「卡片组设置」里改。", "", "group");
				if (d.addCard) {
					this.adding = {
						g: d.addCard,
						col: d.col ?? ""
					};
					this.addDraft = "";
					this.render();
					this.root.querySelector("#dpmAddIn")?.focus();
					return;
				}
				if (d.renameCard !== void 0 && c) return this.askName("重命名卡片", "", c.t, "rename:" + c.id);
				if (d.removeCard !== void 0 && c) {
					if (!window.confirm("删除卡片「" + c.t + "」？它的会话会保留，但不再读取项目记忆。")) return;
					this.sel = null;
					await this.act("card/remove", { id: c.id }, "已删除卡片");
					return;
				}
				if (d.editGroup) {
					this.editG = d.editGroup;
					this.openGroupSettings(d.focusLinks !== void 0);
					return;
				}
				if (d.linkCard !== void 0 && c) return this.openLink("card", c.id);
				if (d.linkGroup) return this.openLink("group", d.linkGroup);
				if (d.unlinkCard && c) {
					await this.act("card/update", {
						id: c.id,
						links: c.links.filter((k) => k !== d.unlinkCard)
					}, "已取消关联");
					return;
				}
				if (d.unlinkGroup && this.editG) {
					const g = this.grp(this.editG);
					await this.act("group/update", {
						id: g.id,
						links: g.links.filter((k) => k !== d.unlinkGroup)
					}, "已取消关联");
					this.renderGroupSettings();
					return;
				}
				if (d.taskDel !== void 0 && c) {
					const tasks = c.tasks.filter((_, k) => k !== Number(d.taskDel));
					await this.act("card/tasks", {
						id: c.id,
						tasks
					});
					return;
				}
				if (d.import !== void 0) return this.openImport();
				if (d.stdel !== void 0) return this.stEdit((list) => {
					list.splice(Number(d.stdel), 1);
				});
				if (d.stup !== void 0) {
					const k = Number(d.stup);
					await this.stEdit((list) => {
						if (k > 0) [list[k - 1], list[k]] = [list[k], list[k - 1]];
					});
					const b = this.root.querySelector("[data-stup=\"" + (k - 1) + "\"]");
					if (b && !b.disabled) b.focus();
					return;
				}
				if (t.id === "dpmStAdd") {
					await this.stEdit((list) => {
						list.push({
							id: "",
							name: "新阶段"
						});
					});
					const inp = this.root.querySelector("[data-stname=\"" + (this.stDraft.length - 1) + "\"]");
					if (inp) {
						inp.focus();
						inp.select();
					}
					return;
				}
				if (t.id === "dpmRepoAdd") return this.openAddRepo();
				if (d.repodel !== void 0 && this.editG) {
					const g = this.grp(this.editG);
					const r = g?.repos[Number(d.repodel)];
					if (!g || !r) return;
					if (await this.act("group/update", {
						id: g.id,
						repos: g.repos.filter((_, k) => k !== Number(d.repodel))
					}, "已移除「" + r.name + "」，项目区软链接已更新")) this.renderGroupSettings();
					return;
				}
				if (t.id === "dpmArPick") return this.pickFolder();
				if (t.id === "dpmArManualAdd") return this.addManualPath();
				if (d.ardel !== void 0 && this.ar) {
					this.ar.sel.splice(Number(d.ardel), 1);
					this.renderAddRepo();
					return;
				}
				if (t.id === "dpmGroupDel") {
					const g = this.grp(this.editG ?? "");
					if (!g || !window.confirm("删除卡片组「" + g.name + "」？组里必须已经没有卡片。")) return;
					if (await this.act("group/remove", { id: g.id }, "已删除卡片组")) this.$("#dpmDlgSt").close();
				}
			}
			onInput(e) {
				const t = e.target;
				if (t.id === "dpmQ") {
					if (e.isComposing) return;
					this.q = t.value.trim().toLowerCase();
					this.render();
					return;
				}
				if (t.id === "dpmAddIn") {
					this.addDraft = t.value;
					return;
				}
				if (t.id === "dpmNameInput") {
					this.$("#dpmNameOk").disabled = t.value.trim() === "";
					return;
				}
				if (t.id === "dpmLkQ" && this.link) {
					this.link.q = t.value.trim().toLowerCase();
					this.renderLink();
					return;
				}
				if (t.id === "dpmLsQ" && this.ls) {
					if (e.isComposing) return;
					this.ls.q = t.value;
					this.renderLinkSess();
					return;
				}
				if (t.id === "dpmArQ" && this.ar) {
					if (e.isComposing) return;
					this.ar.q = t.value.trim().toLowerCase();
					this.$("#dpmArList").innerHTML = this.arListHtml();
					return;
				}
				if (t.dataset.arname !== void 0 && this.ar) {
					this.ar.sel[Number(t.dataset.arname)].name = t.value;
					this.arCheck();
					return;
				}
				if (t.dataset.arrole !== void 0 && this.ar) {
					this.ar.sel[Number(t.dataset.arrole)].role = t.value;
					return;
				}
			}
			async onChange(e) {
				const t = e.target;
				const c = this.sel ? this.card(this.sel) : void 0;
				if (t.dataset.task !== void 0 && c) {
					const tasks = c.tasks.map((x, k) => k === Number(t.dataset.task) ? {
						...x,
						done: t.checked
					} : x);
					await this.act("card/tasks", {
						id: c.id,
						tasks
					});
					return;
				}
				if (t.dataset.lk !== void 0 && this.link) {
					if (t.checked) this.link.sel.add(t.dataset.lk);
					else this.link.sel.delete(t.dataset.lk);
					this.renderLinkCount();
					return;
				}
				if (t.dataset.stname !== void 0) return this.stEdit(() => void 0);
				if (t.dataset.ls !== void 0 && this.ls) {
					const arch = !!t.closest("#dpmLsArch");
					this.ls.sel.push(t.dataset.ls);
					this.renderLinkSess();
					(this.root.querySelector((arch ? "#dpmLsArch" : "#dpmLsActive") + " [data-ls]") ?? this.root.querySelector("#dpmLsQ"))?.focus();
					return;
				}
				if (t.dataset.lsel !== void 0 && this.ls) {
					this.ls.sel = this.ls.sel.filter((x) => x !== t.dataset.lsel);
					this.renderLinkSess();
					(this.root.querySelector("#dpmLsSel [data-lsel]") ?? this.root.querySelector("#dpmLsQ"))?.focus();
					return;
				}
				if (t.dataset.ar !== void 0 && this.ar) {
					if (t.checked) this.arAdd(t.dataset.ar);
					else this.ar.sel = this.ar.sel.filter((x) => x.path !== t.dataset.ar);
					this.renderAddRepo();
					return;
				}
				if ((t.dataset.rpname !== void 0 || t.dataset.rprole !== void 0) && this.editG) return this.saveRepoField(t);
				if (t.id === "dpmGroupName" && this.editG) {
					const v = t.value.trim();
					if (v) await this.act("group/update", {
						id: this.editG,
						name: v
					});
					this.renderGroupSettings();
				}
			}
			async onSubmit(e) {
				const f = e.target;
				if (f.dataset.addcard !== void 0) {
					e.preventDefault();
					return this.submitCard();
				}
				if (f.dataset.addtask === void 0) return;
				e.preventDefault();
				const c = this.sel ? this.card(this.sel) : void 0;
				const inp = this.$("#dpmNewTask");
				const v = inp.value.trim();
				if (!c || !v) return;
				inp.value = "";
				await this.act("card/tasks", {
					id: c.id,
					tasks: c.tasks.concat([{
						text: v,
						done: false
					}])
				});
				const n = this.$("#dpmNewTask");
				if (n) n.focus();
			}
			async onKey(e) {
				const t = e.target;
				const el = t.closest("[data-card]");
				if (el && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
					e.preventDefault();
					const c = this.card(el.dataset.card);
					if (!c) return;
					const peers = this.cell(c.g, c.col);
					const i = peers.findIndex((x) => x.id === c.id);
					const j = e.key === "ArrowUp" ? i - 1 : i + 2;
					if (e.key === "ArrowUp" && i <= 0 || e.key === "ArrowDown" && i >= peers.length - 1) return;
					const before = peers[j]?.id ?? null;
					if (await this.act("card/move", {
						id: c.id,
						group: c.g,
						col: c.col,
						beforeId: before
					}, "已调整顺序")) this.root.querySelector("[data-card=\"" + c.id + "\"]")?.focus();
					return;
				}
				if (el && (e.key === "Enter" || e.key === " ") && t === el) {
					e.preventDefault();
					el.click();
					return;
				}
				if (e.key === "Enter" && (t.id === "dpmLkQ" || t.id === "dpmPopQ" || t.id === "dpmArQ" || t.id === "dpmLsQ")) {
					e.preventDefault();
					return;
				}
				if (e.key === "Enter" && t.id === "dpmArPath") {
					e.preventDefault();
					this.addManualPath();
					return;
				}
				if (e.key === "Enter" && t.id === "dpmNameInput" && this.$("#dpmNameOk").disabled) {
					e.preventDefault();
					return;
				}
				if (e.key === "Escape" && t.id === "dpmAddIn" && !e.isComposing) {
					e.preventDefault();
					const a = this.adding;
					this.adding = null;
					this.addDraft = "";
					this.render();
					if (a) this.root.querySelector("[data-add-card=\"" + a.g + "\"][data-col=\"" + a.col + "\"]")?.focus();
					return;
				}
				if (e.key === "Escape" && this.sel && !this.root.querySelector("dialog[open]")) {
					this.sel = null;
					this.render();
				}
			}
			onDragStart(e) {
				const c = e.target.closest?.("[data-card]");
				if (!c) return;
				this.dragId = c.dataset.card;
				setTimeout(() => c.classList.add("dragging"), 0);
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", this.dragId);
				}
			}
			clearMarks() {
				this.root.querySelectorAll(".cell.over, .ins-before, .ins-after").forEach((n) => n.classList.remove("over", "ins-before", "ins-after"));
			}
			clearDrag() {
				this.clearMarks();
				this.root.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
				this.dragId = null;
				this.dropAt = null;
			}
			onDragOver(e) {
				const cell = this.dragId ? e.target.closest?.(".cell") : null;
				if (!cell) return;
				e.preventDefault();
				this.clearMarks();
				cell.classList.add("over");
				const cards = Array.from(cell.querySelectorAll(".card")).filter((x) => x.dataset.card !== this.dragId);
				let before = null;
				for (const x of cards) {
					const r = x.getBoundingClientRect();
					if (e.clientY < r.top + r.height / 2) {
						before = x;
						break;
					}
				}
				if (before) before.classList.add("ins-before");
				else if (cards.length) cards[cards.length - 1].classList.add("ins-after");
				this.dropAt = {
					g: cell.dataset.g,
					col: cell.dataset.col,
					before: before ? before.dataset.card : null
				};
			}
			async onDrop(e) {
				if (!this.dragId || !this.dropAt) return;
				e.preventDefault();
				const c = this.card(this.dragId);
				const at = this.dropAt;
				this.clearDrag();
				if (!c) return;
				const tops = /* @__PURE__ */ new Map();
				this.root.querySelectorAll(".card").forEach((el) => tops.set(el.dataset.card, el.getBoundingClientRect().top));
				if (!await this.move(c, at.g, at.col, at.before)) return;
				this.root.querySelectorAll(".card").forEach((el) => {
					const t0 = tops.get(el.dataset.card);
					if (t0 === void 0) return;
					const dy = t0 - el.getBoundingClientRect().top;
					if (Math.abs(dy) > 2) {
						el.style.setProperty("--dy", dy + "px");
						el.classList.add("moved");
						setTimeout(() => el.classList.remove("moved"), 380);
					}
				});
				const el = this.root.querySelector("[data-card=\"" + c.id + "\"]");
				if (el) {
					el.classList.add("landed");
					setTimeout(() => el.classList.remove("landed"), 450);
				}
			}
			/** 统一的移动入口（拖拽 / 步骤条 / 推进按钮）。 */
			async move(c, gId, col, before) {
				const g = this.grp(gId);
				const to = g ? this.st(g, col) : void 0;
				if (!g || !to) return false;
				const crossing = c.col !== col || c.g !== gId;
				return this.act("card/move", {
					id: c.id,
					group: gId,
					col,
					beforeId: before
				}, crossing ? "已移到「" + to.name + "」" : "已调整顺序");
			}
			async submitCard() {
				const a = this.adding;
				const inp = this.root.querySelector("#dpmAddIn");
				const v = inp?.value.trim() ?? "";
				if (!a || !inp || v === "" || this.addBusy) return;
				this.addBusy = true;
				inp.value = "";
				this.addDraft = "";
				const before = new Set(this.cards.map((x) => x.id));
				let ok = false;
				try {
					ok = await this.act("card/create", {
						group: a.g,
						col: a.col,
						title: v
					}, "已添加卡片");
				} finally {
					this.addBusy = false;
				}
				if (!ok) {
					this.addDraft = v + this.addDraft;
					this.render();
				}
				const added = ok ? this.cards.find((x) => !before.has(x.id) && x.g === a.g && x.col === a.col) : void 0;
				const el = added ? this.root.querySelector("[data-card=\"" + added.id + "\"]") : null;
				if (el) {
					el.classList.add("landed");
					setTimeout(() => el.classList.remove("landed"), 450);
				}
				this.root.querySelector("#dpmAddIn")?.focus();
			}
			/** 输入框空着失焦 → 只把表单换回按钮（不整体重绘，避免吞掉用户正在点的卡片/按钮）。 */
			onFocusOut(e) {
				const t = e.target;
				if (t.id !== "dpmAddIn" || this.rendering || this.addBusy || this.addDraft.trim() !== "") return;
				const a = this.adding;
				this.adding = null;
				const g = a ? this.grp(a.g) : void 0;
				const st = g && a ? this.st(g, a.col) : void 0;
				const f = t.closest("form");
				if (f && g && st && f.isConnected) f.outerHTML = this.addHtml(g, st);
			}
			nameTarget = "";
			askName(title, hint, value, target) {
				const d = this.$("#dpmDlgName");
				this.$("#dpmNameT").textContent = title;
				this.$("#dpmNameP").textContent = hint;
				const inp = this.$("#dpmNameInput");
				inp.value = value;
				this.$("#dpmNameOk").disabled = value.trim() === "";
				this.nameTarget = target;
				d.returnValue = "";
				d.showModal();
				inp.focus();
				inp.select();
			}
			async onDialogClose(id, d) {
				const ok = d.returnValue === "ok";
				if (id === "dpmDlgName" && ok) {
					const v = this.$("#dpmNameInput").value.trim();
					const [kind, a] = this.nameTarget.split(":");
					if (kind === "group") await this.act("group/create", { name: v }, "卡片组已创建，默认 5 个阶段");
					else if (kind === "rename") await this.act("card/update", {
						id: a,
						title: v
					}, "已重命名");
					return;
				}
				if (id === "dpmDlgLink") {
					if (ok) await this.saveLink();
					this.link = null;
					if (this.$("#dpmDlgSt").open) this.renderGroupSettings();
					return;
				}
				if (id === "dpmDlgImp" && ok) await this.doImport();
				if (id === "dpmDlgSess") {
					const a = this.ls;
					this.ls = null;
					if (ok && a && a.sel.length) await this.saveLinkSess(a);
					return;
				}
				if (id === "dpmDlgCfm") {
					const sid = this.cf;
					this.cf = null;
					if (ok && sid) await this.doUnbind(sid);
					return;
				}
				if (id === "dpmDlgRepo") {
					const a = this.ar;
					this.ar = null;
					if (ok && a && a.sel.length) await this.saveAddRepo(a);
					return;
				}
				if (id === "dpmDlgSt") this.editG = null;
			}
			stDraft = [];
			openGroupSettings(focusLinks) {
				const g = this.grp(this.editG ?? "");
				if (!g) return;
				this.stDraft = g.statuses.map((s) => ({ ...s }));
				this.paintGroupSettings();
				const d = this.$("#dpmDlgSt");
				if (!d.open) d.showModal();
				if (focusLinks) setTimeout(() => this.$("#dpmStLinks")?.scrollIntoView({ block: "start" }), 0);
			}
			renderGroupSettings() {
				if (!this.grp(this.editG ?? "")) return;
				if (this.$("#dpmStList").querySelector("[data-stname]")) this.readDrafts();
				this.paintGroupSettings();
			}
			paintGroupSettings() {
				const g = this.grp(this.editG ?? "");
				if (!g) return;
				this.$("#dpmStP").textContent = "只影响「" + g.name + "」。阶段就是看板上的列，只用来给卡片分组；名称、数量、顺序都可以改。";
				const gl = g.links.map((k) => {
					const s = this.stateOf(k);
					return "<div class=\"gl-row\">" + ic("mem") + "<span class=\"grow\"><span class=\"nm\">" + esc(s?.slug ?? k) + "</span> <span class=\"meta\">" + esc(s?.project ?? "未找到") + "</span></span><button type=\"button\" class=\"ib\" data-unlink-group=\"" + esc(k) + "\" aria-label=\"取消关联 " + esc(k) + "\">" + ic("x") + "</button></div>";
				}).join("") || "<p class=\"meta\">还没有关联。关联后，这个组里所有卡片的会话都会自动读取。</p>";
				const repos = g.repos.map((r, i) => "<div class=\"rp-row\"><input class=\"fld\" aria-label=\"仓库名 " + (i + 1) + "\" data-rpname=\"" + i + "\" value=\"" + esc(r.name) + "\" maxlength=\"120\"><input class=\"fld\" aria-label=\"仓库角色 " + (i + 1) + "\" data-rprole=\"" + i + "\" value=\"" + esc(r.role) + "\" maxlength=\"40\"><span class=\"mono\" title=\"" + esc(r.path) + "\">" + esc(r.path) + "</span><button type=\"button\" class=\"ib\" data-repodel=\"" + i + "\" aria-label=\"移除仓库 " + esc(r.name) + "\">" + ic("x") + "</button></div>").join("");
				const sts = this.stDraft.map((st, i) => "<div class=\"st-row\"><button type=\"button\" class=\"ib sm grip\" data-stup=\"" + i + "\" aria-label=\"上移 " + esc(st.name) + "\"" + (i === 0 ? " disabled" : "") + ">" + (i + 1) + "</button><input class=\"fld\" aria-label=\"阶段名 " + (i + 1) + "\" data-stname=\"" + i + "\" value=\"" + esc(st.name) + "\"><button type=\"button\" class=\"ib\" data-stdel=\"" + i + "\" aria-label=\"删除阶段 " + esc(st.name) + "\">" + ic("x") + "</button></div>").join("");
				this.$("#dpmStList").innerHTML = "<label class=\"lbl\" for=\"dpmGroupName\">组名</label><input class=\"fld\" id=\"dpmGroupName\" value=\"" + esc(g.name) + "\"><div class=\"lbl row\" id=\"dpmStLinks\">关联的落盘项目 · " + g.links.length + "<span class=\"grow\"></span><button type=\"button\" class=\"btn ghost sm\" data-link-group=\"" + esc(g.id) + "\">" + ic("plus") + "关联</button></div>" + gl + "<div class=\"lbl row\">仓库 · " + g.repos.length + "<span class=\"grow\"></span><button type=\"button\" class=\"btn ghost sm\" id=\"dpmRepoAdd\">" + ic("plus") + "添加</button></div>" + (repos ? repos + "<p class=\"meta\">名称、角色改完离开输入框即保存；要换路径就移除后重新添加。</p>" : "<p class=\"meta\">还没有挂载仓库。点「添加」从 dsh 已添加的工作区里选，或选一个文件夹；仓库会以软链接出现在项目区目录的 repos/" + esc(g.name) + "/ 下。</p>") + "<div class=\"lbl\">阶段（点序号上移）</div>" + sts + "<button type=\"button\" class=\"btn ghost sm\" id=\"dpmStAdd\">" + ic("plus") + "添加阶段</button><p class=\"meta\">阶段下还有卡片时不能删除，先把卡片移走。</p>";
			}
			readDrafts() {
				this.stDraft = this.stDraft.map((st, i) => {
					const name = this.root.querySelector("[data-stname=\"" + i + "\"]")?.value ?? st.name;
					return {
						id: st.id,
						name
					};
				});
			}
			/** 阶段编辑即时生效：改草稿 → 服务端校验（失败点名并回滚草稿）。 */
			async stEdit(fn) {
				this.readDrafts();
				const next = this.stDraft.map((s) => ({ ...s }));
				fn(next);
				const g = this.grp(this.editG ?? "");
				if (!g) return;
				const ok = await this.act("group/update", {
					id: g.id,
					statuses: next
				});
				this.stDraft = (ok ? this.grp(g.id) : g).statuses.map((s) => ({ ...s }));
				this.paintGroupSettings();
			}
			/** 已挂载仓库行内改名/角色：失焦（change）即保存；空名或重名当场拒绝并恢复原值。 */
			async saveRepoField(t) {
				const g = this.grp(this.editG ?? "");
				const i = Number(t.dataset.rpname ?? t.dataset.rprole);
				const r = g?.repos[i];
				if (!g || !r) return;
				const v = t.value.replace(/\s+/g, " ").trim();
				let next = r;
				if (t.dataset.rpname !== void 0) {
					if (!v) {
						t.value = r.name;
						this.host.toast("仓库名不能为空", "err");
						return;
					}
					if (g.repos.some((x, k) => k !== i && x.name === v)) {
						t.value = r.name;
						this.host.toast("「" + g.name + "」已有同名仓库「" + v + "」", "err");
						return;
					}
					if (v === r.name) return;
					next = {
						...r,
						name: v
					};
				} else {
					const role = v || "仓库";
					t.value = role;
					if (role === r.role) return;
					next = {
						...r,
						role
					};
				}
				if (await this.act("group/update", {
					id: g.id,
					repos: g.repos.map((x, k) => k === i ? next : x)
				}, "已保存，项目区软链接已更新")) this.renderGroupSettings();
				else t.value = t.dataset.rpname !== void 0 ? r.name : r.role;
			}
			/** dsh 会话 / 工作区推送变化：详情栏重绘；弹窗开着时刷新候选（保留搜索词与已选）。 */
			onSessionsChanged() {
				if (this.disposed) return;
				if (this.sel && !this.$("#dpmDlgSess").open) this.render();
				if (this.ls) this.renderLinkSess();
			}
			sessIndex() {
				const m = /* @__PURE__ */ new Map();
				for (const s of this.host.allSessions()) m.set(s.id, s);
				return m;
			}
			linkedHtml(c) {
				const refs = (this.snap?.board.sessions ?? []).filter((s) => s.cardId === c.id);
				if (!refs.length) return "<p class=\"meta\">还没有会话。可以「以此卡片新建会话」，或关联已有会话。</p>";
				const idx = this.sessIndex();
				const canRestore = this.snap?.caps?.unarchive !== false;
				return refs.map((r) => {
					const v = idx.get(r.sessionId);
					const title = v?.title ?? r.title ?? "会话 " + r.sessionId.slice(0, 8);
					const unl = "<button type=\"button\" class=\"ib sm unl tipbtn\" data-unbind=\"" + esc(r.sessionId) + "\" aria-label=\"解除关联 " + esc(title) + "\">" + ic("unlink") + "<span class=\"tip\" aria-hidden=\"true\">解除关联</span></button>";
					if (!v) return "<div class=\"lsess gone\"><div class=\"l1\"><span class=\"lname\">会话已删除</span>" + unl + "</div><div class=\"l2\"><span class=\"sub2\">原名「" + esc(title) + "」</span></div></div>";
					const name = v.archived ? "<span class=\"lname\" title=\"已归档的会话不能打开，先「恢复活跃」\">" + esc(title) + "</span>" : "<button type=\"button\" class=\"lname\" data-open-sess=\"" + esc(v.id) + "\" title=\"打开会话：" + esc(title) + "\">" + esc(title) + "</button>";
					const restore = v.archived ? "<button type=\"button\" class=\"btn ghost xs\" data-restore=\"" + esc(v.id) + "\"" + (canRestore && !this.restoring.has(v.id) ? "" : " disabled") + " title=\"" + (canRestore ? "恢复到工作区原来的位置" : "当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）") + "\">" + ic("restore") + (this.restoring.has(v.id) ? "恢复中…" : "恢复活跃") + "</button>" : "";
					return "<div class=\"lsess" + (v.archived ? " archived" : "") + "\"><div class=\"l1\">" + name + unl + "</div><div class=\"l2\">" + (v.archived ? "<span class=\"chip arch\">已归档</span>" : "<span class=\"chip live\">活跃</span>") + "<span class=\"sub2\">" + esc(v.ws) + " · " + esc(ago(v.updatedAt)) + "</span>" + restore + "</div></div>";
				}).join("");
			}
			openLinkSess(c) {
				this.ls = {
					card: c.id,
					q: "",
					sel: [],
					busy: false
				};
				this.$("#dpmLsQ").value = "";
				this.$("#dpmLsP").textContent = "勾选的会话会关联到「" + c.t + "」，之后每一轮自动读取这张卡片的落盘项目记忆（会话里已读过的不重复读取）。一个会话只属于一张卡片。";
				this.renderLinkSess();
				const d = this.$("#dpmDlgSess");
				d.returnValue = "";
				d.showModal();
				this.$("#dpmLsQ").focus();
			}
			lsRow(v, picked) {
				const ref = (this.snap?.board.sessions ?? []).find((s) => s.sessionId === v.id);
				const other = ref && this.ls && ref.cardId !== this.ls.card ? this.card(ref.cardId) : void 0;
				return "<label class=\"ls-row\"><input type=\"checkbox\" " + (picked ? "data-lsel" : "data-ls") + "=\"" + esc(v.id) + "\"" + (picked ? " checked" : "") + "><span class=\"txt\"><span class=\"nm\" title=\"" + esc(v.title) + "\">" + esc(v.title) + "</span>" + (other ? "<span class=\"oth\" title=\"保存后从「" + esc(other.t) + "」移到本卡片\">已关联在「" + esc(other.t) + "」</span>" : "") + "</span>" + (picked ? "<span class=\"chip " + (v.archived ? "arch\">已归档" : "live\">活跃") + "</span>" : "") + "<span class=\"t\">" + esc(picked ? v.ws + " · " + ago(v.updatedAt) : ago(v.updatedAt)) + "</span></label>";
			}
			renderLinkSess() {
				const a = this.ls;
				if (!a) return;
				const all = this.host.allSessions();
				const mine = new Set((this.snap?.board.sessions ?? []).filter((s) => s.cardId === a.card).map((s) => s.sessionId));
				const exclude = /* @__PURE__ */ new Set([...mine, ...a.sel]);
				const col = (archived) => {
					const gs = groupSessions(all, {
						archived,
						exclude,
						q: a.q
					});
					const n = gs.reduce((k, g) => k + g[1].length, 0);
					return {
						html: gs.map(([ws, list]) => "<div class=\"ls-grp\">" + ic("folder") + esc(ws) + "</div>" + list.map((v) => this.lsRow(v, false)).join("")).join("") || "<p class=\"ls-empty\">" + (a.q.trim() ? "没有匹配的会话" : archived ? "没有已归档的会话" : "没有可关联的活跃会话") + "</p>",
						n
					};
				};
				const act = col(false);
				const arc = col(true);
				this.$("#dpmLsA").textContent = "活跃会话 · " + act.n;
				this.$("#dpmLsR").textContent = "已归档会话 · " + arc.n;
				this.$("#dpmLsActive").innerHTML = act.html;
				this.$("#dpmLsArch").innerHTML = arc.html;
				const idx = new Map(all.map((v) => [v.id, v]));
				const sel = a.sel.map((id) => idx.get(id)).filter((v) => !!v);
				this.$("#dpmLsSel").innerHTML = sel.map((v) => this.lsRow(v, true)).join("") || "<p class=\"ar-empty\">还没有选择会话。在上面两列里勾选。</p>";
				this.$("#dpmLsN").textContent = String(sel.length);
				const moved = sel.filter((v) => {
					const r = (this.snap?.board.sessions ?? []).find((s) => s.sessionId === v.id);
					return !!r && r.cardId !== a.card;
				}).length;
				this.$("#dpmLsCount").textContent = sel.length ? "将关联 " + sel.length + " 个会话" + (moved ? "（其中 " + moved + " 个从别的卡片移过来）" : "") : "";
				this.$("#dpmLsOk").disabled = a.busy || !sel.length;
			}
			async saveLinkSess(a) {
				const idx = this.sessIndex();
				const sessions = a.sel.map((id) => ({
					sessionId: id,
					title: idx.get(id)?.title
				}));
				try {
					const r = await post("session/link", {
						cardId: a.card,
						sessions
					});
					if (this.disposed) return;
					this.snap = r;
					this.render();
					this.host.toast("已关联 " + r.result.linked + " 个会话" + (r.result.moved ? "，其中 " + r.result.moved + " 个从别的卡片移过来" : ""));
				} catch (e) {
					this.host.toast("关联失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
					this.ls = {
						...a,
						busy: false
					};
					const d = this.$("#dpmDlgSess");
					d.returnValue = "";
					this.renderLinkSess();
					d.showModal();
					return;
				}
				this.root.querySelector("[data-link-sess]")?.focus();
			}
			askUnbind(sessionId) {
				const ref = (this.snap?.board.sessions ?? []).find((s) => s.sessionId === sessionId);
				if (!ref) return;
				const v = this.sessIndex().get(sessionId);
				const c = this.card(ref.cardId);
				this.cf = sessionId;
				this.$("#dpmCfP").textContent = "解除「" + (v?.title ?? ref.title ?? "已删除的会话") + "」和「" + (c?.t ?? "") + "」的关联？会话本身不会删除，之后也可以重新关联。";
				const d = this.$("#dpmDlgCfm");
				d.returnValue = "";
				d.showModal();
				this.root.querySelector("#dpmDlgCfm [data-dlg-cancel]")?.focus();
			}
			async doUnbind(sessionId) {
				try {
					const r = await post("session/unlink", { sessionId });
					if (this.disposed) return;
					this.snap = r;
					this.render();
					this.host.toast("已解除关联");
				} catch (e) {
					this.host.toast("解除关联失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
					await this.refresh();
				}
				this.root.querySelector("[data-link-sess]")?.focus();
			}
			/** 恢复活跃：不需要确认；会话回到工作区归档前的位置（归档从不改动工作区里的会话顺序）。 */
			async restoreSession(sessionId) {
				if (this.restoring.has(sessionId)) return;
				const v = this.sessIndex().get(sessionId);
				this.restoring.add(sessionId);
				this.render();
				try {
					const r = await post("session/unarchive", { sessionId });
					if (this.disposed) return;
					this.snap = r;
					this.host.toast(r.result.restored ? "已恢复「" + (v?.title ?? "会话") + "」，回到「" + (v?.ws ?? "工作区") + "」原来的位置" : "这个会话已经是活跃状态");
				} catch (e) {
					this.host.toast("恢复失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				} finally {
					this.restoring.delete(sessionId);
				}
				setTimeout(() => {
					if (!this.disposed) {
						this.render();
						this.root.querySelector(".detail [data-open-sess=\"" + sessionId + "\"]")?.focus();
					}
				}, 300);
			}
			openAddRepo() {
				const g = this.grp(this.editG ?? "");
				if (!g) return;
				this.ar = {
					g: g.id,
					q: "",
					sel: [],
					manual: false,
					busy: false
				};
				this.$("#dpmArQ").value = "";
				this.$("#dpmArP").textContent = "仓库会以软链接挂到「" + g.name + "」下，这个组里每张卡片的会话都能读写。可以多选。";
				this.renderAddRepo();
				const d = this.$("#dpmDlgRepo");
				d.returnValue = "";
				d.showModal();
				this.$("#dpmArQ").focus();
			}
			arMounted(path) {
				const g = this.ar ? this.grp(this.ar.g) : void 0;
				return !!g && g.repos.some((r) => normPath(r.path) === normPath(path));
			}
			arAdd(path) {
				const a = this.ar;
				if (!a) return false;
				if (this.arMounted(path)) {
					this.host.toast("「" + folderName(path) + "」已挂载在本组", "err");
					return false;
				}
				if (a.sel.some((x) => normPath(x.path) === normPath(path))) {
					this.host.toast("「" + folderName(path) + "」已在「已选」里", "err");
					return false;
				}
				a.sel.push({
					path,
					name: folderName(path),
					role: "仓库"
				});
				return true;
			}
			arErrs() {
				const a = this.ar;
				const g = a ? this.grp(a.g) : void 0;
				if (!a || !g) return [];
				return a.sel.map((x, i) => {
					const n = x.name.replace(/\s+/g, " ").trim();
					if (!n) return "名称不能为空";
					if (n.length > 120) return "名称超过 120 字";
					if (g.repos.some((r) => r.name === n)) return "本组已有同名仓库「" + n + "」";
					if (a.sel.slice(0, i).some((o) => o.name.replace(/\s+/g, " ").trim() === n)) return "和上面的仓库重名，改一个名字";
					return "";
				});
			}
			arListHtml() {
				const a = this.ar;
				if (!a) return "";
				const all = this.host.workspaces();
				const list = all.filter((w) => !a.q || (w.title + " " + w.path).toLowerCase().includes(a.q));
				if (!all.length) return "<p class=\"ar-empty\">dsh 里还没有添加过工作区。点「选择文件夹…」直接选一个。</p>";
				return list.map((w) => {
					const m = this.arMounted(w.path);
					const on = m || a.sel.some((x) => normPath(x.path) === normPath(w.path));
					return "<label class=\"pk" + (m ? " lock" : "") + "\"><input type=\"checkbox\" data-ar=\"" + esc(w.path) + "\"" + (on ? " checked" : "") + (m ? " disabled" : "") + "><span class=\"txt\"><span class=\"nm\">" + esc(w.title) + "</span><span class=\"mono\">" + esc(w.path) + "</span></span>" + (m ? "<span class=\"chip plain\">已挂载</span>" : "") + "</label>";
				}).join("") || "<p class=\"meta\">没有匹配的工作区</p>";
			}
			arSelHtml() {
				const a = this.ar;
				if (!a) return "";
				return a.sel.map((x, i) => "<div class=\"rp-row\"><input class=\"fld\" data-arname=\"" + i + "\" aria-label=\"仓库名 " + (i + 1) + "\" aria-describedby=\"dpmArE" + i + "\" maxlength=\"120\" value=\"" + esc(x.name) + "\"><input class=\"fld\" data-arrole=\"" + i + "\" aria-label=\"仓库角色 " + (i + 1) + "\" maxlength=\"40\" value=\"" + esc(x.role) + "\"><span class=\"mono\" title=\"" + esc(x.path) + "\">" + esc(x.path) + "</span><button type=\"button\" class=\"ib\" data-ardel=\"" + i + "\" aria-label=\"从已选移除 " + esc(x.name || x.path) + "\">" + ic("x") + "</button><p class=\"rp-err\" id=\"dpmArE" + i + "\" hidden></p></div>").join("") || "<p class=\"ar-empty\">还没有选择仓库。勾选上面的工作区，或点「选择文件夹…」。</p>";
			}
			arCheck() {
				const a = this.ar;
				if (!a) return;
				const errs = this.arErrs();
				errs.forEach((m, i) => {
					const inp = this.root.querySelector("[data-arname=\"" + i + "\"]");
					const p = this.root.querySelector("#dpmArE" + i);
					if (inp) {
						inp.classList.toggle("bad", !!m);
						if (m) inp.setAttribute("aria-invalid", "true");
						else inp.removeAttribute("aria-invalid");
					}
					if (p) {
						p.textContent = m;
						p.hidden = !m;
					}
				});
				this.$("#dpmArSelN").textContent = String(a.sel.length);
				this.$("#dpmArCount").textContent = a.sel.length ? "将挂载 " + a.sel.length + " 个仓库" : "";
				this.$("#dpmArOk").disabled = a.busy || !a.sel.length || errs.some(Boolean);
			}
			renderAddRepo() {
				const a = this.ar;
				if (!a) return;
				this.$("#dpmArList").innerHTML = this.arListHtml();
				this.$("#dpmArSel").innerHTML = this.arSelHtml();
				this.$("#dpmArManual").hidden = !a.manual;
				this.$("#dpmArPick").hidden = a.manual;
				this.arCheck();
			}
			focusLastSel() {
				const a = this.ar;
				const i = a ? this.root.querySelector("[data-arname=\"" + (a.sel.length - 1) + "\"]") : null;
				if (i) {
					i.focus();
					i.select();
				}
			}
			/** 「选择文件夹…」：调 dsh 的选文件夹对话框；网页文件浏览器模式下（不支持）降级为手输绝对路径。 */
			async pickFolder() {
				const a = this.ar;
				if (!a || a.busy) return;
				a.busy = true;
				this.arCheck();
				let path = null;
				try {
					path = await this.host.pickDirectory();
				} catch (e) {
					if (this.ar === a) {
						a.manual = true;
						this.renderAddRepo();
						this.$("#dpmArPath").focus();
					}
					console.warn("[dsh-project-manager] uiWorkspace.pickDirectory 失败，改为手输路径：", e);
					this.host.toast("当前 dsh 打不开系统选文件夹对话框，请直接输入文件夹的绝对路径", "err");
				} finally {
					a.busy = false;
				}
				if (this.ar !== a) return;
				if (path && this.arAdd(path)) {
					this.renderAddRepo();
					this.focusLastSel();
				} else this.arCheck();
			}
			addManualPath() {
				const inp = this.root.querySelector("#dpmArPath");
				const v = inp?.value.trim() ?? "";
				if (!inp || !v) return;
				if (!v.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(v)) {
					this.host.toast("请输入绝对路径：" + v, "err");
					return;
				}
				if (this.arAdd(v)) {
					inp.value = "";
					this.renderAddRepo();
					this.focusLastSel();
				}
			}
			async saveAddRepo(a) {
				const repos = a.sel.map((x) => ({
					name: x.name.replace(/\s+/g, " ").trim(),
					role: x.role.trim() || "仓库",
					path: x.path
				}));
				if (!await this.act("group/repos-add", {
					id: a.g,
					repos
				}, "已挂载 " + repos.length + " 个仓库，项目区软链接已更新")) {
					this.ar = {
						...a,
						busy: false
					};
					const d = this.$("#dpmDlgRepo");
					d.returnValue = "";
					this.renderAddRepo();
					d.showModal();
					return;
				}
				if (this.$("#dpmDlgSt").open) this.renderGroupSettings();
				this.root.querySelector("#dpmRepoAdd")?.focus();
			}
			openLink(kind, id) {
				const c = kind === "card" ? this.card(id) : void 0;
				const g = kind === "group" ? this.grp(id) : this.grp(c?.g ?? "");
				if (!g) return;
				this.link = {
					kind,
					id,
					sel: new Set(kind === "group" ? g.links : c?.links ?? []),
					locked: new Set(kind === "card" ? g.links : []),
					q: ""
				};
				this.$("#dpmLkP").textContent = kind === "group" ? "「" + g.name + "」里所有卡片新建的会话，都会自动读取这些落盘项目的记忆。" : "「" + (c?.t ?? "") + "」新建的会话会自动读取这些落盘项目的记忆；卡片组已关联的会一并读取，这里不能取消。";
				this.$("#dpmLkQ").value = "";
				this.renderLink();
				const d = this.$("#dpmDlgLink");
				d.returnValue = "";
				d.showModal();
				this.$("#dpmLkQ").focus();
			}
			renderLink() {
				const L = this.link;
				if (!L) return;
				const list = (this.snap?.states ?? []).filter((x) => !L.q || (x.slug + " " + x.project + " " + x.status).toLowerCase().includes(L.q));
				let html = "";
				let last = "";
				for (const x of list) {
					if (x.project !== last) {
						html += "<div class=\"pk-grp\">" + esc(x.project) + "</div>";
						last = x.project;
					}
					const lock = L.locked.has(x.key);
					html += "<label class=\"pk" + (lock ? " lock" : "") + "\"><input type=\"checkbox\" data-lk=\"" + esc(x.key) + "\"" + (lock || L.sel.has(x.key) ? " checked" : "") + (lock ? " disabled" : "") + "><span><span class=\"nm\">" + esc(x.slug) + "</span>" + (lock ? " <span class=\"chip plain\">卡片组已关联</span>" : "") + "<br><span class=\"meta\">" + esc(x.status || "暂无状态说明") + "</span></span></label>";
				}
				this.$("#dpmLkList").innerHTML = html || "<p class=\"meta\">没有匹配的落盘项目（扫描 ~/.ai/projects/&lt;project&gt;/memory/designs/）</p>";
				this.renderLinkCount();
			}
			renderLinkCount() {
				const L = this.link;
				if (!L) return;
				const n = (/* @__PURE__ */ new Set([...L.sel, ...L.locked])).size;
				this.$("#dpmLkCount").textContent = "已选 " + n + " 个";
			}
			async saveLink() {
				const L = this.link;
				if (!L) return;
				const keys = Array.from(L.sel).filter((k) => !L.locked.has(k));
				if (L.kind === "group") await this.act("group/update", {
					id: L.id,
					links: keys
				}, "已保存关联 · " + keys.length + " 个落盘项目");
				else await this.act("card/update", {
					id: L.id,
					links: keys
				}, "已保存关联 · " + keys.length + " 个落盘项目");
			}
			openImport() {
				if (!this.groups.length) {
					this.host.toast("先新建一个卡片组", "err");
					return;
				}
				const used = new Set(this.cards.flatMap((c) => c.links));
				const list = (this.snap?.states ?? []).filter((s) => !used.has(s.key));
				this.$("#dpmImList").innerHTML = list.length ? list.map((s) => "<label class=\"imp\"><input type=\"checkbox\" data-imp=\"" + esc(s.key) + "\"><span><b>" + esc(s.slug) + "</b><br><span class=\"mono\">" + esc(s.key) + "</span><br><span class=\"meta\">" + esc(s.status || "暂无状态说明") + "</span></span></label>").join("") : "<p class=\"meta\">所有落盘项目都已经有对应卡片了</p>";
				this.$("#dpmImGroup").innerHTML = this.groups.map((g) => "<option value=\"" + esc(g.id) + "\">" + esc(g.name) + "</option>").join("");
				const d = this.$("#dpmDlgImp");
				d.returnValue = "";
				d.showModal();
			}
			async doImport() {
				const gid = this.$("#dpmImGroup").value;
				const keys = Array.from(this.root.querySelectorAll("[data-imp]:checked")).map((n) => n.dataset.imp);
				let n = 0;
				for (const k of keys) {
					const s = this.stateOf(k);
					if (await this.act("card/create", {
						group: gid,
						title: s?.slug ?? k,
						links: [k]
					})) n++;
				}
				if (n) this.host.toast("已导入 " + n + " 张卡片");
			}
		};
		const DIALOGS = String.raw`
<dialog class="dpm-dialog" id="dpmDlgName" aria-labelledby="dpmNameT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmNameT"></h2><p id="dpmNameP"></p></div>
  <div class="dlg-b"><label class="lbl" for="dpmNameInput">名称</label><input class="fld" id="dpmNameInput" autocomplete="off"></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmNameOk" type="submit" value="ok" disabled>确定</button></div>
</form></dialog>
<dialog class="dpm-dialog wide" id="dpmDlgSt" aria-labelledby="dpmStT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmStT">卡片组设置</h2><p id="dpmStP"></p></div>
  <div class="dlg-b" id="dpmStList"></div>
  <div class="dlg-f"><button class="btn ghost danger" type="button" id="dpmGroupDel">删除卡片组</button><span class="sp"></span><button class="btn primary" type="submit" value="ok">完成</button></div>
</form></dialog>
<dialog class="dpm-dialog wide" id="dpmDlgRepo" aria-labelledby="dpmArT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmArT">添加挂载仓库</h2><p id="dpmArP"></p></div>
  <div class="dlg-b">
    <div class="ar-top"><label class="sr-only" for="dpmArQ">搜索 dsh 已添加的工作区</label><input class="fld" id="dpmArQ" placeholder="搜索 dsh 已添加的工作区" autocomplete="off"><button type="button" class="btn" id="dpmArPick">%FOLDER%选择文件夹…</button></div>
    <div class="ar-manual" id="dpmArManual" hidden><label class="sr-only" for="dpmArPath">仓库文件夹的绝对路径</label><input class="fld" id="dpmArPath" placeholder="输入文件夹绝对路径，例如 ~/code/repo 展开后的完整路径" autocomplete="off"><button type="button" class="btn" id="dpmArManualAdd">添加</button></div>
    <div class="ar-sec">dsh 已添加的工作区</div>
    <div class="pk-list ar-list" id="dpmArList"></div>
    <div class="ar-sec"><span>已选 · <span id="dpmArSelN">0</span></span><span class="grow"></span><span class="meta">默认名称是文件夹名，可以改</span></div>
    <div id="dpmArSel"></div>
  </div>
  <div class="dlg-f"><span class="meta" id="dpmArCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmArOk" type="submit" value="ok" disabled>保存</button></div>
</form></dialog>
<dialog class="dpm-dialog xwide" id="dpmDlgSess" aria-labelledby="dpmLsT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmLsT">关联已有会话</h2><p id="dpmLsP"></p></div>
  <div class="dlg-b">
    <label class="sr-only" for="dpmLsQ">搜索会话</label><input class="fld" id="dpmLsQ" placeholder="搜索会话名或仓库" autocomplete="off">
    <div class="ls-cols"><section class="ls-col" aria-labelledby="dpmLsA"><h3 id="dpmLsA"></h3><div class="ls-list" id="dpmLsActive"></div></section><section class="ls-col" aria-labelledby="dpmLsR"><h3 id="dpmLsR"></h3><div class="ls-list" id="dpmLsArch"></div></section></div>
    <div class="ar-sec"><span>已选会话 · <span id="dpmLsN">0</span></span><span class="grow"></span><span class="meta">取消勾选即放回候选</span></div>
    <div id="dpmLsSel"></div>
  </div>
  <div class="dlg-f"><span class="meta" id="dpmLsCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmLsOk" type="submit" value="ok" disabled>保存关联</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgCfm" aria-labelledby="dpmCfT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmCfT">解除关联</h2><p id="dpmCfP"></p></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary danger-fill" id="dpmCfOk" type="submit" value="ok">解除关联</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgLink" aria-labelledby="dpmLkT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmLkT">关联落盘项目</h2><p id="dpmLkP"></p></div>
  <div class="dlg-b"><label class="sr-only" for="dpmLkQ">搜索落盘项目</label><input class="fld" id="dpmLkQ" placeholder="搜索 slug 或状态" autocomplete="off"><div class="pk-list" id="dpmLkList"></div></div>
  <div class="dlg-f"><span class="meta" id="dpmLkCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">保存关联</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgImp" aria-labelledby="dpmImT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmImT">导入落盘项目</h2><p>每个选中的落盘项目生成一张卡片并自动关联。只读扫描 ~/.ai，不会修改 STATE。</p></div>
  <div class="dlg-b"><div id="dpmImList"></div><label class="lbl" for="dpmImGroup">放进卡片组</label><select class="fld" id="dpmImGroup"></select></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">导入所选</button></div>
</form></dialog>
`;
		//#endregion
		//#region src/client/sidebar.ts
		/**
		* 工作区列表里「项目区」行的增强（DOM 层，官方未开放行内插槽）：
		*  - 标题右侧插入看板按钮（append 到行内、CSS order 定位，不改动 React 管理的子节点顺序）；
		*  - 捕获阶段拦截该行「+」：先选卡片再建会话（不影响其他工作区的「+」）。
		* 依据：dsh-client-ui-workspace 0.1.5 行结构 [role=treeitem][aria-expanded]、标题 [class*=projectText] [class*=title]、
		*       操作区 [class*=rowActions]、「+」aria-label「在“X”中新建会话」；先例 dsh-manage-sessions/src/client/workspace-copy.ts。
		* 降级：找不到结构时 ready()=false，由 index.ts 改用官方 panellist 入口，功能不丢。
		*/
		const ROW = "[role=\"treeitem\"][aria-expanded]";
		const MARK = "data-dpm-kb";
		var SidebarBridge = class {
			hooks;
			obs = null;
			scheduled = false;
			seen = false;
			onCapture = (e) => {
				const b = e.target?.closest?.("button");
				if (!b || b.hasAttribute(MARK)) return;
				const row = b.closest(ROW);
				if (!row || !this.isHubRow(row)) return;
				const label = b.getAttribute("aria-label") ?? "";
				if (!/新建会话|New session/i.test(label)) return;
				e.stopPropagation();
				e.preventDefault();
				this.hooks.pickCard(b);
			};
			constructor(hooks) {
				this.hooks = hooks;
			}
			start() {
				document.addEventListener("click", this.onCapture, true);
				this.obs = new MutationObserver(() => this.schedule());
				this.obs.observe(document.body, {
					childList: true,
					subtree: true
				});
				this.schedule();
			}
			stop() {
				document.removeEventListener("click", this.onCapture, true);
				this.obs?.disconnect();
				this.obs = null;
				document.querySelectorAll("[" + MARK + "]").forEach((n) => n.remove());
			}
			/** 当前侧栏里是否有「项目区」行（index.ts 据此决定是否启用 panellist 降级入口）。 */
			ready() {
				return this.seen;
			}
			refresh() {
				this.schedule();
			}
			schedule() {
				if (this.scheduled) return;
				this.scheduled = true;
				requestAnimationFrame(() => {
					this.scheduled = false;
					this.augment();
				});
			}
			titleOf(row) {
				return ((row.querySelector("[class*=\"projectText\"] [class*=\"title\"]") ?? row.querySelector("[class*=\"title\"]"))?.textContent ?? "").trim();
			}
			isHubRow(row) {
				return this.titleOf(row) === this.hooks.hubTitle();
			}
			augment() {
				const open = this.hooks.boardOpen();
				let found = false;
				for (const row of Array.from(document.querySelectorAll(ROW))) {
					const existing = row.querySelector("[" + MARK + "]");
					if (!this.isHubRow(row)) {
						existing?.remove();
						continue;
					}
					found = true;
					const titleBox = row.querySelector("[class*=\"projectText\"]") ?? row.querySelector("[class*=\"title\"]")?.parentElement;
					if (!titleBox) continue;
					let btn = existing;
					if (!btn) {
						btn = document.createElement("button");
						btn.type = "button";
						btn.className = "dpm-kb";
						btn.setAttribute(MARK, "");
						btn.setAttribute("aria-label", "打开项目看板");
						btn.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3.5\" y=\"4\" width=\"4.5\" height=\"15\" rx=\"2.25\"/><rect x=\"9.75\" y=\"4\" width=\"4.5\" height=\"9.5\" rx=\"2.25\"/><rect x=\"16\" y=\"4\" width=\"4.5\" height=\"12.5\" rx=\"2.25\"/></svg><span class=\"tip\" aria-hidden=\"true\">项目看板</span>";
						btn.addEventListener("click", (e) => {
							e.stopPropagation();
							e.preventDefault();
							this.hooks.openBoard();
						});
						btn.addEventListener("pointerdown", (e) => e.stopPropagation());
						titleBox.appendChild(btn);
					}
					btn.setAttribute("aria-pressed", String(open));
				}
				this.seen = found;
			}
		};
		//#endregion
		//#region src/client/style.gen.ts
		const CSS = ".dpm, .dpm-kb, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts {\n  --pm-select: rgba(15, 17, 21, .06);\n  --pm-brand: #2f5fcc; --pm-brand-ink: #ffffff; --pm-brand-soft: #eaf0fd; --pm-brand-soft-2: #d9e4fb; --pm-brand-line: #c3d3f7;\n  --pm-ok: #146c3f; --pm-ok-soft: #e6faed; --pm-warn: #94480a; --pm-warn-soft: #fff3e2; --pm-warn-line: #f2c38c;\n  --pm-card: var(--dsw-alias-bg-layer-1, #ffffff); --pm-lane: #f7f8fa;\n  --pm-shadow: 0 1px 2px rgba(15, 17, 21, .06); --pm-shadow-2: 0 8px 28px rgba(15, 17, 21, .12);\n  --ease: cubic-bezier(.2, .8, .2, 1);\n}\nbody[data-ds-dark-theme] :is(.dpm, .dpm-kb, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts) {\n  --pm-select: rgba(255, 255, 255, .08);\n  --pm-brand: #6c97ff; --pm-brand-ink: #0b1020; --pm-brand-soft: #1d2a4a; --pm-brand-soft-2: #26365e; --pm-brand-line: #35508f;\n  --pm-ok: #56cc86; --pm-ok-soft: #1f3a29; --pm-warn: #f2a650; --pm-warn-soft: #33240f; --pm-warn-line: #6b4a1f;\n  --pm-card: var(--dsw-alias-bg-layer-1, #232324); --pm-lane: #1c1c1e;\n  --pm-shadow: 0 1px 2px rgba(0, 0, 0, .4); --pm-shadow-2: 0 12px 32px rgba(0, 0, 0, .5);\n}\n.dpm { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; font-size: 14px; line-height: 1.5; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }\n.dpm-pop, .dpm-dock, .dpm-kb, .dpm *, .dpm-pop *, .dpm-dock *, .dpm-dialog * { box-sizing: border-box; }\n.dpm button, .dpm input, .dpm select, .dpm textarea, .dpm-dialog button, .dpm-dialog input, .dpm-dialog select, .dpm-dialog textarea, .dpm-pop input { font: inherit; color: inherit; }\n.dpm svg.i, .dpm-pop svg.i, .dpm-dock svg.i, .dpm-dialog svg.i, .dpm-toasts svg.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n.dpm :focus-visible, .dpm-dialog :focus-visible, .dpm-kb:focus-visible { outline: 2px solid var(--pm-brand); outline-offset: 2px; border-radius: 8px; }\n.dpm .sr-only, .dpm-dialog .sr-only, .dpm-pop .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }\n.dpm .grow, .dpm-pop .grow, .dpm-dock .grow, .dpm-dialog .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .meta, .dpm-dialog .meta { font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm .mono, .dpm-dialog .mono { font-family: \"SF Mono\", Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; }\n.dpm-err { margin: 12px 24px 0; padding: 8px 12px; border: 1px solid var(--pm-warn-line); border-radius: 10px; background: var(--pm-warn-soft); color: var(--pm-warn); font-size: 13px; }\n\n/* ── 插件：「项目区」行内元素 ── */\n.dpm-kb { position: relative; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 7px; background: var(--pm-brand-soft); color: var(--pm-brand); transition: background 160ms var(--ease), color 160ms var(--ease), transform 120ms var(--ease), box-shadow 160ms var(--ease); }\n.dpm-kb svg { width: 14px; height: 14px; fill: currentColor; stroke: none; }\n.dpm-kb:hover { background: var(--pm-brand-soft-2); }\n.dpm-kb:active { transform: scale(.92); }\n.dpm-kb[aria-pressed=\"true\"] { background: var(--pm-brand); color: var(--pm-brand-ink); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm-kb .tip { position: absolute; left: 50%; top: calc(100% + 6px); z-index: 5; padding: 4px 8px; border-radius: 6px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 12px; white-space: nowrap; opacity: 0; transform: translate(-50%, -2px); pointer-events: none; transition: opacity 140ms var(--ease), transform 140ms var(--ease); }\n.dpm-kb:hover .tip, .dpm-kb:focus-visible .tip { opacity: 1; transform: translate(-50%, 0); transition-delay: 350ms; }\n\n/* ── 插件：选择项目浮层 ── */\n.dpm-pop { position: fixed; z-index: 30; width: 300px; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); box-shadow: var(--pm-shadow-2); animation: popin 180ms var(--ease); }\n@keyframes popin { from { opacity: 0; transform: translateY(-4px) scale(.98); } }\n.dpm-pop h3 { margin: 4px 8px 8px; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-pop input { width: 100%; height: 36px; margin-bottom: 8px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); outline: 0; }\n.dpm-pop input:focus { border-color: var(--pm-brand); }\n.dpm-pop ul { max-height: 280px; overflow: auto; margin: 0; padding: 0; list-style: none; }\n.dpm-pop .grp { padding: 8px 8px 4px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .opt { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 8px; border-radius: 8px; font-size: 14px; }\n.dpm-pop .opt[aria-selected=\"true\"] { background: var(--pm-brand-soft); color: var(--pm-brand); }\n.dpm-pop .opt .t { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .hint { margin: 8px 8px 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n\n/* ── 插件：项目看板面板 ── */\n@keyframes fadein { from { opacity: 0; } }\n:is(.dpm, .dpm-dialog) .pm-top { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid var(--dsw-alias-border-l2); flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .pm-top h1 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.3; }\n:is(.dpm, .dpm-dialog) .pm-top p { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .pm-top .ttl { flex: 1 1 260px; min-width: 0; }\n:is(.dpm, .dpm-dialog) .search { display: flex; align-items: center; gap: 8px; height: 36px; width: 220px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; }\n:is(.dpm, .dpm-dialog) .search input::placeholder { color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-weight: 600; white-space: nowrap; transition: background 160ms var(--ease), transform 120ms var(--ease); }\n:is(.dpm, .dpm-dialog) .btn:hover { background: var(--dsw-alias-button-floating-hover); }\n:is(.dpm, .dpm-dialog) .btn:active { transform: translateY(1px); }\n:is(.dpm, .dpm-dialog) .btn.primary { background: var(--pm-brand); border-color: var(--pm-brand); color: var(--pm-brand-ink); }\n:is(.dpm, .dpm-dialog) .btn.primary:hover { filter: brightness(1.08); }\n:is(.dpm, .dpm-dialog) .btn.ghost { border-color: transparent; background: transparent; }\n:is(.dpm, .dpm-dialog) .btn.ghost:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .btn.lg { width: 100%; min-height: 44px; font-size: 15px; }\n:is(.dpm, .dpm-dialog) .btn:disabled { opacity: .5; cursor: not-allowed; }\n:is(.dpm, .dpm-dialog) .ib { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .ib:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n:is(.dpm, .dpm-dialog) .pm-body { position: relative; flex: 1; min-height: 0; min-width: 0; display: flex; }\n:is(.dpm, .dpm-dialog) .board-wrap { position: relative; flex: 1; min-width: 0; overflow: auto; padding: 16px 24px 24px; }\n:is(.dpm, .dpm-dialog) .lane { min-width: 0; margin-bottom: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--pm-lane); }\n:is(.dpm, .dpm-dialog) .lane-h { display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .lane-h h2 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.4; }\n:is(.dpm, .dpm-dialog) .lane-h .meta { font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .lane-h .sp { flex: 1; }\n:is(.dpm, .dpm-dialog) .lane.collapsed .chev { transform: rotate(-90deg); }\n:is(.dpm, .dpm-dialog) .lane.collapsed .lane-in { display: none; }\n:is(.dpm, .dpm-dialog) .lane-in { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 0 12px 12px; overflow-x: auto; }\n:is(.dpm, .dpm-dialog) .shead, .lane-b { display: grid; grid-template-columns: repeat(var(--cols), minmax(212px, 1fr)); gap: 8px; }\n:is(.dpm, .dpm-dialog) .lane-b { align-items: start; }\n:is(.dpm, .dpm-dialog) .colh { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 14px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .colh .nm { white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .colh .n { height: 20px; line-height: 20px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .cell { display: flex; flex-direction: column; gap: 8px; min-height: 96px; padding: 8px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); transition: background 160ms var(--ease), box-shadow 160ms var(--ease); }\n:is(.dpm, .dpm-dialog) .cell.over { background: var(--pm-brand-soft); box-shadow: inset 0 0 0 2px var(--pm-brand); }\n/* 每个阶段底部常驻「添加卡片」（原型 v8） */\n.dpm .addc { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background 140ms var(--ease), color 140ms var(--ease); }\n.dpm .addc:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n.dpm .cell.empty .addc { justify-content: center; min-height: 40px; border: 1px dashed var(--dsw-alias-border-l3); }\n.dpm .cell.over .addc { visibility: hidden; }\n.dpm .addc-f { display: flex; flex-direction: column; gap: 4px; animation: fadein 160ms var(--ease); }\n.dpm .addc-f input { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--pm-brand); border-radius: 8px; background: var(--pm-card); color: inherit; font: inherit; outline: 0; box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm .addc-f .hint { padding: 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n@media (max-width: 720px), (pointer: coarse) { .dpm .addc { min-height: 40px; } }\n:is(.dpm, .dpm-dialog) .card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--pm-card); box-shadow: var(--pm-shadow); text-align: left; transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease), transform 200ms var(--ease), opacity 160ms var(--ease); }\n:is(.dpm, .dpm-dialog) .card:hover { border-color: var(--dsw-alias-border-l3); box-shadow: var(--pm-shadow-2); transform: translateY(-1px); }\n:is(.dpm, .dpm-dialog) .card[aria-pressed=\"true\"] { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .card.dragging { opacity: .45; }\n:is(.dpm, .dpm-dialog) .card.landed { animation: land 420ms var(--ease); }\n@keyframes land { 0% { transform: scale(.96); } 100% { transform: none; } }\n:is(.dpm, .dpm-dialog) .card h3 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.4; word-break: break-word; }\n:is(.dpm, .dpm-dialog) .card p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n:is(.dpm, .dpm-dialog) .foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .prog { flex: 1; min-width: 96px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n:is(.dpm, .dpm-dialog) .bar { flex: 1; height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); overflow: hidden; }\n:is(.dpm, .dpm-dialog) .bar i { display: block; height: 100%; border-radius: 999px; background: var(--pm-brand); transition: width 400ms var(--ease); }\n:is(.dpm, .dpm-dialog) .chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .chip svg.i { width: 12px; height: 12px; }\n:is(.dpm, .dpm-dialog) .chip.warn { background: var(--pm-warn-soft); color: var(--pm-warn); border-color: var(--pm-warn-line); }\n:is(.dpm, .dpm-dialog) .chip.brand { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.plain { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .empty-board { display: grid; place-items: center; gap: 12px; padding: 48px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }\n\n/* ── 插件：详情栏 ── */\n:is(.dpm, .dpm-dialog) .detail { width: 380px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); animation: slidein 240ms var(--ease); }\n@keyframes slidein { from { opacity: 0; transform: translateX(16px); } }\n:is(.dpm, .dpm-dialog) .d-h { display: flex; align-items: flex-start; gap: 8px; padding: 16px 20px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .d-h h2 { margin: 0; font-size: 18px; font-weight: 650; line-height: 1.35; word-break: break-word; }\n:is(.dpm, .dpm-dialog) .d-h .sub { margin-top: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .d-b { flex: 1; overflow: auto; padding: 0 20px 16px; }\n:is(.dpm, .dpm-dialog) .sec { padding: 16px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .sec:last-child { border-bottom: 0; }\n:is(.dpm, .dpm-dialog) .sec h3 { margin: 0 0 8px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .statebox { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }\n:is(.dpm, .dpm-dialog) .statebox .l { margin: 8px 0 0; font-size: 14px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .statebox .nx { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .statebox .nx b { margin-right: 8px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .repo { display: flex; align-items: center; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n:is(.dpm, .dpm-dialog) .repo .txt { flex: 1; min-width: 0; }\n:is(.dpm, .dpm-dialog) .repo .nm { font-size: 14px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .repo .mono { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .steps { display: flex; margin: 4px 0 12px; }\n:is(.dpm, .dpm-dialog) .step { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 48px; padding: 4px 0; border: 0; background: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .step::before { content: \"\"; position: absolute; top: 13px; left: -50%; width: 100%; height: 2px; background: var(--dsw-alias-border-l3); }\n:is(.dpm, .dpm-dialog) .step:first-child::before { display: none; }\n:is(.dpm, .dpm-dialog) .step .nd { position: relative; z-index: 1; width: 20px; height: 20px; display: grid; place-items: center; border: 2px solid var(--dsw-alias-border-l3); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--pm-brand-ink); transition: background 200ms var(--ease), border-color 200ms var(--ease), box-shadow 200ms var(--ease); }\n:is(.dpm, .dpm-dialog) .step .nd svg.i { width: 12px; height: 12px; stroke-width: 3; }\n:is(.dpm, .dpm-dialog) .step.past .nd { background: var(--pm-brand); border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .step.past::before, .step.cur::before { background: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .step.cur { color: var(--dsw-alias-label-primary); font-weight: 650; }\n:is(.dpm, .dpm-dialog) .step.cur .nd { border-color: var(--pm-brand); box-shadow: 0 0 0 4px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .step:hover .nd { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .task { display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 4px 8px; border-radius: 8px; font-size: 14px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .task:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .task input { width: 16px; height: 16px; accent-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .task.done span { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }\n:is(.dpm, .dpm-dialog) .addtask { display: flex; gap: 8px; margin-top: 8px; }\n:is(.dpm, .dpm-dialog) .addtask input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); outline: 0; }\n:is(.dpm, .dpm-dialog) .addtask input:focus { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .psess { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; margin-bottom: 4px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 14px; }\n:is(.dpm, .dpm-dialog) .psess:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .psess .t { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .d-f { display: flex; flex-direction: column; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .d-f .note { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n\n/* ── 插件：记忆关联 ── */\n:is(.dpm, .dpm-dialog) .chip.mem { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.as-btn { cursor: pointer; font-family: inherit; }\n:is(.dpm, .dpm-dialog) .chip.as-btn:hover { background: var(--pm-brand-soft-2); }\n:is(.dpm, .dpm-dialog) .btn.sm { min-height: 28px; padding: 0 8px; font-size: 13px; }\n:is(.dpm, .dpm-dialog) .meta.mb { margin: 0 0 8px; }\n:is(.dpm, .dpm-dialog) .mrow { display: flex; gap: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); animation: fadein 220ms var(--ease); }\n:is(.dpm, .dpm-dialog) .mrow .txt { flex: 1; min-width: 0; }\n:is(.dpm, .dpm-dialog) .mrow .nm { font-size: 14px; font-weight: 650; word-break: break-all; }\n:is(.dpm, .dpm-dialog) .mrow .l { margin: 4px 0 0; font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .mrow .nx { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .mrow .nx b { margin-right: 8px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .mside { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }\n:is(.dpm, .dpm-dialog) .gl-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px 4px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n:is(.dpm, .dpm-dialog) .gl-row .nm { font-weight: 650; }\n:is(.dpm, .dpm-dialog) .pk-list { max-height: 50vh; overflow: auto; }\n:is(.dpm, .dpm-dialog) .pk { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .pk:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .pk input { margin-top: 4px; accent-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .pk.lock { opacity: .7; cursor: default; }\n:is(.dpm, .dpm-dialog) .pk .nm { font-weight: 650; }\n:is(.dpm, .dpm-dialog) .pk-grp { margin: 12px 0 8px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .pk-grp:first-child { margin-top: 0; }\n:is(.dpm, .dpm-dialog) .card.dragging { opacity: .4; }\n:is(.dpm, .dpm-dialog) .cell .card { position: relative; }\n:is(.dpm, .dpm-dialog) .card.ins-before::before, .card.ins-after::after { content: \"\"; position: absolute; left: 4px; right: 4px; height: 3px; border-radius: 999px; background: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .card.ins-before::before { top: -6px; }\n:is(.dpm, .dpm-dialog) .card.ins-after::after { bottom: -6px; }\n:is(.dpm, .dpm-dialog) .card.moved { animation: moved 360ms var(--ease); }\n@keyframes moved { from { transform: translateY(var(--dy, 0)); } }\n\n/* ── 对话框 / toast ── */\n.dpm-dialog { width: min(560px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--pm-shadow-2); }\n.dpm-dialog::backdrop { background: rgba(15, 17, 21, .32); }\n.dpm-dialog[open] { animation: popin 220ms var(--ease); }\n:is(.dpm, .dpm-dialog) .dlg-h { padding: 20px 20px 4px; }\n:is(.dpm, .dpm-dialog) .dlg-h h2 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.4; }\n:is(.dpm, .dpm-dialog) .dlg-h p { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .dlg-b { padding: 12px 20px; max-height: 60vh; overflow: auto; }\n:is(.dpm, .dpm-dialog) .dlg-b label.lbl { display: block; margin: 8px 0 4px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .fld { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); outline: 0; }\n:is(.dpm, .dpm-dialog) textarea.fld { height: auto; padding: 8px 12px; resize: vertical; }\n:is(.dpm, .dpm-dialog) .fld:focus { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .dlg-f { display: flex; align-items: center; gap: 8px; padding: 12px 20px 20px; }\n:is(.dpm, .dpm-dialog) .dlg-f .sp { flex: 1; }\n:is(.dpm, .dpm-dialog) .st-row { display: grid; grid-template-columns: 24px 1fr 32px; gap: 8px; align-items: center; margin-bottom: 8px; }\n:is(.dpm, .dpm-dialog) .st-row .grip { text-align: center; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .st-row label { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .imp { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .imp:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .imp input { margin-top: 4px; accent-color: var(--pm-brand); }\n.dpm-toasts { position: fixed; left: 50%; bottom: 24px; z-index: 50; display: flex; flex-direction: column; gap: 8px; transform: translateX(-50%); pointer-events: none; }\n.dpm-toasts .toast { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 12px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 13px; box-shadow: var(--pm-shadow-2); animation: popin 240ms var(--ease); }\n\n@media (max-width: 1100px) { .dpm .detail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 20; box-shadow: var(--pm-shadow-2); } }\n@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }\n\n.dpm .pm-top, .dpm .pm-body { animation: fadein 220ms var(--ease); }\n.dpm-kb { flex: none; margin-left: 6px; align-self: center; }\n[role=\"treeitem\"] [class*=\"projectText\"]:has(> .dpm-kb) { flex-direction: row; align-items: center; justify-content: flex-start; }\n[role=\"treeitem\"] [class*=\"projectText\"]:has(> .dpm-kb) > [class*=\"title\"] { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-toasts { position: fixed; left: 50%; bottom: 24px; z-index: 2147483000; display: flex; flex-direction: column; gap: 8px; transform: translateX(-50%); pointer-events: none; }\n.dpm-toasts .toast.err { background: var(--pm-warn); color: #fff; }\n.dpm-pop { position: fixed; z-index: 2147482000; width: 300px; }\n.dpm .pm-top .ttl { flex: 1 1 260px; min-width: 0; }\n.dpm .ib.sm { width: 24px; height: 24px; }\n.dpm .ib.sm svg.i { width: 14px; height: 14px; }\n.dpm .task { justify-content: space-between; }\n.dpm .task label { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; cursor: pointer; }\n.dpm .task .ib.sm { opacity: 0; }\n.dpm .task:hover .ib.sm, .dpm .task .ib.sm:focus-visible { opacity: 1; }\n.dpm .btn.danger, .dpm-dialog .btn.danger { color: var(--pm-warn); }\n.dpm-dialog.wide { width: min(640px, calc(100vw - 32px)); }\n.dpm-dialog .lbl.row { display: flex; align-items: center; gap: 8px; }\n.dpm-dialog .rp-row { display: grid; grid-template-columns: minmax(120px, 1fr) 88px minmax(140px, 1.6fr) 32px; gap: 4px 8px; align-items: center; margin-bottom: 8px; }\n.dpm-dialog .rp-row .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-dialog .rp-err { grid-column: 1 / -1; margin: 0; font-size: 12px; color: #c62828; }\n.dpm-dialog .fld.bad { border-color: #c62828; }\nbody[data-ds-dark-theme] .dpm-dialog .rp-err { color: #ff8a80; }\nbody[data-ds-dark-theme] .dpm-dialog .fld.bad { border-color: #ff8a80; }\n/* 添加挂载仓库（原型 v9） */\n.dpm-dialog .ar-top, .dpm-dialog .ar-manual { display: flex; align-items: center; gap: 8px; }\n.dpm-dialog .ar-manual { margin-top: 8px; }\n.dpm-dialog .ar-top .fld, .dpm-dialog .ar-manual .fld { flex: 1; min-width: 0; }\n.dpm-dialog [hidden] { display: none !important; }\n.dpm-dialog .ar-sec { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ar-sec .meta { font-weight: 400; }\n.dpm-dialog .ar-list { max-height: 28vh; margin-top: 0; }\n.dpm-dialog .pk .txt { flex: 1; min-width: 0; }\n.dpm-dialog .pk .txt .mono { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-dialog .pk > .chip { flex: none; margin-left: auto; align-self: center; }\n/* 本卡片的会话（原型 v10） */\n.dpm .lsess { margin-bottom: 4px; padding: 6px 4px 6px 8px; border-radius: 8px; }\n.dpm .lsess:hover { background: var(--pm-select); }\n.dpm .lsess .l1 { display: flex; align-items: center; gap: 8px; }\n.dpm .lsess .l2 { display: flex; align-items: center; gap: 8px; min-height: 28px; margin-top: 2px; }\n.dpm .lsess .l2 .sub2 { flex: 1; min-width: 0; }\n.dpm .lsess .lname { flex: 1; min-width: 0; display: block; padding: 0; border: 0; background: none; color: inherit; font: inherit; font-size: 14px; font-weight: 600; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }\n.dpm .lsess button.lname:hover { color: var(--pm-brand); text-decoration: underline; }\n.dpm .lsess .sub2 { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .lsess.gone .lname, .dpm .lsess.archived .lname { color: var(--dsw-alias-label-secondary); cursor: default; }\n.dpm .lsess.gone .lname { font-weight: 400; }\n.dpm .lsess .chip, :is(.dpm, .dpm-dialog) .ls-row .chip { flex: none; }\n:is(.dpm, .dpm-dialog) .chip.live { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.arch { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); }\n.dpm .btn.xs { flex: none; min-height: 28px; padding: 0 8px; gap: 4px; border-radius: 8px; font-size: 13px; }\n.dpm .btn.xs svg.i { width: 14px; height: 14px; }\n.dpm .ib.unl { flex: none; }\n.dpm .ib.unl:hover { color: #c62828; background: rgba(198, 40, 40, .08); }\nbody[data-ds-dark-theme] .dpm .ib.unl:hover { color: #ff8a80; background: rgba(255, 138, 128, .12); }\n.dpm .tipbtn { position: relative; }\n.dpm .tipbtn .tip { position: absolute; right: 0; top: calc(100% + 4px); z-index: 5; padding: 4px 8px; border-radius: 6px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 12px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 120ms var(--ease); }\n.dpm .tipbtn:hover .tip, .dpm .tipbtn:focus-visible .tip { opacity: 1; }\n.dpm-dialog.xwide { width: min(760px, calc(100vw - 32px)); }\n.dpm-dialog .ls-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }\n.dpm-dialog .ls-col { min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm-dialog .ls-col h3 { margin: 0 0 8px; padding: 0 4px; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-list { max-height: 30vh; overflow: auto; }\n.dpm-dialog .ls-grp { display: flex; align-items: center; gap: 6px; margin: 12px 4px 4px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-grp:first-child { margin-top: 0; }\n.dpm-dialog .ls-grp svg.i { width: 14px; height: 14px; }\n.dpm-dialog .ls-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px; border-radius: 8px; cursor: pointer; }\n.dpm-dialog .ls-row:hover { background: var(--pm-select); }\n.dpm-dialog .ls-row input { flex: none; accent-color: var(--pm-brand); }\n.dpm-dialog .ls-row .txt { flex: 1; min-width: 0; }\n.dpm-dialog .ls-row .nm { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }\n.dpm-dialog .ls-row .oth { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--pm-warn); }\n.dpm-dialog .ls-row .t { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-row .chip { height: 22px; font-weight: 400; }\n.dpm-dialog .ls-empty { margin: 8px 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog #dpmLsSel .ls-row { margin-bottom: 4px; border: 1px solid var(--pm-brand-line); background: var(--pm-brand-soft); }\n.dpm-dialog .btn.primary.danger-fill { background: #c62828; border-color: #c62828; color: #ffffff; }\n@media (max-width: 720px) { .dpm-dialog .ls-cols { grid-template-columns: 1fr; } }\n.dpm-dialog .ar-empty { margin: 0; padding: 16px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: 10px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .st-row .grip { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .pk-list { margin-top: 12px; }\n@media (prefers-reduced-motion: reduce) { .dpm *, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts * { animation-duration: 1ms !important; transition-duration: 1ms !important; } }\n\n.dpm-dock { box-sizing: border-box; width: calc(100% - var(--dsh-composer-side-clearance, 0px) * 2); max-width: var(--dsh-composer-card-max-width, 100%); margin: 0 auto 8px; border: 1px solid var(--pm-brand-line); border-radius: 12px; background: var(--pm-brand-soft); color: var(--dsw-alias-label-primary); animation: fadein 240ms var(--ease); }\n.dpm-dock .dock-h { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 12px; border: 0; background: transparent; color: var(--pm-brand); font: inherit; font-size: 13px; font-weight: 650; text-align: left; cursor: pointer; }\n.dpm-dock .dock-h .grow { display: flex; align-items: center; gap: 8px; }\n.dpm-dock .chev { display: inline-flex; transition: transform 200ms var(--ease); }\n.dpm-dock.open .chev { transform: rotate(180deg); }\n.dpm-dock ul { margin: 0; padding: 0 12px 10px; list-style: none; display: flex; flex-direction: column; gap: 4px; }\n.dpm-dock li { display: flex; gap: 8px; font-size: 13px; line-height: 1.5; }\n.dpm-dock li b { flex: none; font-weight: 650; }\n.dpm-dock li span { color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n/* design-review 修正 */\n.dpm-dialog .imp .meta, .dpm-dialog .pk .meta { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n.dpm-dialog #dpmImList { max-height: 46vh; overflow: auto; }\n.dpm .lane-b { align-items: stretch; }\n.dpm .btn.danger, .dpm-dialog .btn.danger { color: #c62828; }\nbody[data-ds-dark-theme] :is(.dpm, .dpm-dialog) .btn.danger { color: #ff8a80; }\n.dpm-dialog .dlg-b > .lbl { margin-top: 20px; }\n.dpm-dialog .dlg-b > .lbl:first-child { margin-top: 0; }\n.dpm-dialog #dpmStAdd { margin: 4px 0 8px; }\n\n";
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-project-manager client：主区看板面板 + 「项目区」行看板按钮/「+」接管 + 会话记忆提示 + 选卡片浮层。
		* 生命周期：所有 DOM/监听都挂在 ctx.effect 上，卸载即净（样式、按钮、浮层、toast 全部移除）。
		*/
		const PANEL = "dsh-project-manager:board";
		let HUB_TITLE = "项目区";
		const inject = [
			"slots",
			"layout",
			"uiWorkspace",
			"sessions",
			"theme",
			"workspaces"
		];
		let boardOpen = false;
		function apply(ctx) {
			ctx.effect(() => {
				const s = document.createElement("style");
				s.dataset.plugin = "dsh-project-manager";
				s.textContent = CSS;
				document.head.append(s);
				return () => s.remove();
			}, "dsh-project-manager: css");
			let toastBox = null;
			const toast = (msg, kind = "ok") => {
				if (!toastBox) {
					toastBox = document.createElement("div");
					toastBox.className = "dpm-toasts";
					toastBox.setAttribute("role", "status");
					toastBox.setAttribute("aria-live", "polite");
					document.body.append(toastBox);
				}
				for (const n of Array.from(toastBox.children)) if (n.textContent === msg) n.remove();
				const el = document.createElement("div");
				el.className = "toast" + (kind === "err" ? " err" : "");
				el.innerHTML = ic(kind === "err" ? "x" : "check") + "<span>" + esc(msg) + "</span>";
				toastBox.append(el);
				while (toastBox.children.length > 2) toastBox.firstElementChild?.remove();
				setTimeout(() => el.remove(), kind === "err" ? 5e3 : 2400);
			};
			ctx.effect(() => () => {
				toastBox?.remove();
				toastBox = null;
			}, "dsh-project-manager: toast");
			const isDark = () => {
				try {
					return ctx.theme.getTheme().active.colorScheme === "dark";
				} catch {
					return document.body.hasAttribute("data-ds-dark-theme");
				}
			};
			const setDark = (dark) => {
				try {
					ctx.theme.setTheme(dark ? "dark" : "light");
				} catch (e) {
					toast("切换主题失败：" + String(e), "err");
				}
			};
			let creating = false;
			const newSession = async (cardId) => {
				if (creating) return;
				creating = true;
				try {
					const { workspaceId } = await post("session/prepare", { cardId });
					const sessionId = await ctx.sessions.create({ workspaceId });
					const r = await post("session/bind", {
						sessionId,
						cardId
					});
					ctx.uiWorkspace.openSession(sessionId);
					bridge.refresh();
					toast("已在「" + HUB_TITLE + "」新建会话" + (r.permission ? " · 完全权限" : ""));
				} catch (e) {
					toast("新建项目会话失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				} finally {
					creating = false;
				}
			};
			let pop = null;
			const closePop = () => {
				pop?.el.remove();
				pop = null;
			};
			const popItems = () => {
				if (!pop) return [];
				const b = pop.snap.board;
				const out = [];
				for (const g of b.groups) {
					if (pop.g && g.id !== pop.g) continue;
					const cs = b.cards.filter((c) => c.g === g.id).sort((a, c) => g.statuses.findIndex((s) => s.id === a.col) - g.statuses.findIndex((s) => s.id === c.col) || a.order - c.order);
					for (const c of cs) {
						if (pop.q && !(c.t + " " + g.name).toLowerCase().includes(pop.q)) continue;
						out.push({
							id: c.id,
							t: c.t,
							g: g.id,
							gname: g.name,
							st: g.statuses.find((s) => s.id === c.col)?.name ?? ""
						});
					}
				}
				return out;
			};
			const renderPop = () => {
				if (!pop) return;
				const items = popItems();
				pop.i = Math.max(0, Math.min(pop.i, items.length - 1));
				let html = "";
				let last = "";
				items.forEach((c, k) => {
					if (c.g !== last) {
						html += "<li class=\"grp\" role=\"presentation\">" + esc(c.gname) + "</li>";
						last = c.g;
					}
					html += "<li class=\"opt\" role=\"option\" id=\"dpm-opt-" + esc(c.id) + "\" data-pick=\"" + esc(c.id) + "\" aria-selected=\"" + (k === pop.i) + "\"><span class=\"grow\">" + esc(c.t) + "</span><span class=\"t\">" + esc(c.st) + "</span></li>";
				});
				const list = pop.el.querySelector("ul");
				list.innerHTML = html || "<li class=\"grp\" role=\"presentation\">" + (pop.snap.board.cards.length ? "没有匹配的卡片" : "还没有卡片，先去项目看板添加") + "</li>";
				pop.el.querySelector("input").setAttribute("aria-activedescendant", items[pop.i] ? "dpm-opt-" + items[pop.i].id : "");
				pop.el.querySelector("[aria-selected=\"true\"]")?.scrollIntoView({ block: "nearest" });
			};
			let opening = false;
			const pickCard = async (anchor, groupId) => {
				if (pop) {
					const same = pop.anchor === anchor;
					closePop();
					if (same) return;
				}
				if (opening) return;
				opening = true;
				let snap;
				try {
					snap = await getState();
				} catch (e) {
					toast("读取看板失败：" + String(e), "err");
					opening = false;
					return;
				}
				opening = false;
				if (snap.hub?.title) HUB_TITLE = snap.hub.title;
				const el = document.createElement("div");
				el.className = "dpm-pop";
				el.setAttribute("role", "dialog");
				el.setAttribute("aria-label", "选择卡片");
				el.innerHTML = "<h3>新会话属于哪张卡片？</h3><label class=\"sr-only\" for=\"dpmPopQ\">搜索卡片</label><input id=\"dpmPopQ\" role=\"combobox\" aria-expanded=\"true\" aria-controls=\"dpmPopList\" autocomplete=\"off\" placeholder=\"搜索卡片\"><ul id=\"dpmPopList\" role=\"listbox\"></ul><p class=\"hint\">↑↓ 选择 · 回车新建 · Esc 关闭</p>";
				document.body.append(el);
				const r = anchor.getBoundingClientRect();
				el.style.left = Math.max(8, Math.min(r.left, innerWidth - 316)) + "px";
				el.style.top = Math.min(r.bottom + 6, innerHeight - 360) + "px";
				pop = {
					el,
					q: "",
					i: 0,
					g: groupId,
					snap,
					anchor
				};
				renderPop();
				const q = el.querySelector("input");
				q.addEventListener("input", () => {
					if (!pop) return;
					pop.q = q.value.trim().toLowerCase();
					pop.i = 0;
					renderPop();
				});
				q.addEventListener("keydown", (e) => {
					if (!pop) return;
					const items = popItems();
					if (e.key === "ArrowDown") {
						e.preventDefault();
						pop.i = Math.min(items.length - 1, pop.i + 1);
						renderPop();
					} else if (e.key === "ArrowUp") {
						e.preventDefault();
						pop.i = Math.max(0, pop.i - 1);
						renderPop();
					} else if (e.key === "Enter") {
						e.preventDefault();
						const it = items[pop.i];
						if (it) {
							closePop();
							newSession(it.id);
						}
					} else if (e.key === "Escape") {
						e.preventDefault();
						const a = pop.anchor;
						closePop();
						a.focus();
					}
				});
				el.addEventListener("click", (e) => {
					const li = e.target.closest("[data-pick]");
					if (li) {
						closePop();
						newSession(li.dataset.pick);
					}
				});
				setTimeout(() => q.focus(), 0);
			};
			ctx.effect(() => {
				const outside = (e) => {
					if (pop && !pop.el.contains(e.target) && !pop.anchor.contains(e.target)) closePop();
				};
				const onResize = () => closePop();
				document.addEventListener("mousedown", outside, true);
				addEventListener("resize", onResize);
				return () => {
					document.removeEventListener("mousedown", outside, true);
					removeEventListener("resize", onResize);
					closePop();
				};
			}, "dsh-project-manager: picker");
			const bridge = new SidebarBridge({
				hubTitle: () => HUB_TITLE,
				boardOpen: () => boardOpen,
				openBoard: () => ctx.layout.selectPanel(PANEL),
				pickCard: (a) => void pickCard(a)
			});
			ctx.effect(() => {
				bridge.start();
				return () => bridge.stop();
			}, "dsh-project-manager: sidebar");
			getState().then((s) => {
				if (s.hub?.title) {
					HUB_TITLE = s.hub.title;
					bridge.refresh();
				}
			}).catch(() => void 0);
			const Board = (props) => {
				const ref = (0, react.useRef)(null);
				const active = props.usePanelInfo ? props.usePanelInfo((i) => i.activePanelId === PANEL) : true;
				const [, bump] = (0, react.useState)(0);
				(0, react.useEffect)(() => {
					boardOpen = active;
					bridge.refresh();
				}, [active]);
				(0, react.useEffect)(() => {
					const el = ref.current;
					if (!el) return;
					const view = new BoardView(el, {
						newSession,
						openSession: (id) => ctx.uiWorkspace.openSession(id),
						isDark,
						setDark,
						toast,
						pickCard: (a, g) => void pickCard(a, g),
						workspaces: () => {
							const items = ctx.workspaces.list.getSnapshot().items;
							const hubPath = view.snap?.hub.path;
							return items.filter((w) => w.path !== hubPath).map((w) => ({
								title: w.title,
								path: w.path
							}));
						},
						allSessions: () => {
							const ws = ctx.workspaces.list.getSnapshot();
							const arch = new Set(ws.archivedSessionIds ?? []);
							const owner = /* @__PURE__ */ new Map();
							for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, {
								title: w.path === view.snap?.hub.path ? HUB_TITLE : w.title,
								id: w.workspaceId
							});
							const st = ctx.sessions.list.getSnapshot();
							const out = [];
							for (const id of st.ids) {
								const s = st.byId[id];
								if (!s || s.parentId || s.origin === "subagent") continue;
								const o = owner.get(id);
								out.push({
									id,
									title: s.title || s.displayTitle || id,
									ws: o?.title ?? (s.cwd ? s.cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || s.cwd : "未分组"),
									wsId: o?.id ?? null,
									updatedAt: s.updatedAt,
									archived: arch.has(id)
								});
							}
							return out;
						},
						pickDirectory: async () => {
							if (typeof ctx.uiWorkspace.pickDirectory !== "function") throw new Error("当前 dsh 版本没有 pickDirectory");
							return ctx.uiWorkspace.pickDirectory();
						}
					});
					const off = ctx.on("theme/change", () => {
						view.render();
						bump((n) => n + 1);
					});
					let raf = 0;
					const onStore = () => {
						if (raf || !view.sel) return;
						raf = requestAnimationFrame(() => {
							raf = 0;
							view.onSessionsChanged();
						});
					};
					const offS = ctx.sessions.list.subscribe(onStore);
					const offW = ctx.workspaces.list.subscribe(onStore);
					return () => {
						off();
						offS();
						offW();
						if (raf) cancelAnimationFrame(raf);
						view.dispose();
						boardOpen = false;
						bridge.refresh();
					};
				}, []);
				return (0, react.createElement)("div", {
					ref,
					style: {
						height: "100%",
						minHeight: 0
					}
				});
			};
			ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL
			}, Board)), "dsh-project-manager: panel");
			const Glyph = (p) => (0, react.createElement)("svg", {
				viewBox: "0 0 24 24",
				width: p.size ?? 16,
				height: p.size ?? 16,
				"aria-hidden": "true",
				fill: "currentColor",
				dangerouslySetInnerHTML: { __html: "<rect x=\"3.5\" y=\"4\" width=\"4.5\" height=\"15\" rx=\"2.25\"/><rect x=\"9.75\" y=\"4\" width=\"4.5\" height=\"9.5\" rx=\"2.25\"/><rect x=\"16\" y=\"4\" width=\"4.5\" height=\"12.5\" rx=\"2.25\"/>" }
			});
			ctx.effect(() => {
				let off = null;
				let misses = 0;
				const tick = () => {
					misses = bridge.ready() ? 0 : misses + 1;
					const want = misses >= 2;
					if (want && !off) off = ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
						name: "sidebar.panellist",
						id: PANEL,
						order: 5,
						label: "项目看板"
					}, Glyph));
					if (!want && off) {
						off();
						off = null;
					}
				};
				const t = setInterval(tick, 1500);
				return () => {
					clearInterval(t);
					off?.();
				};
			}, "dsh-project-manager: fallback entry");
			const Dock = (props) => {
				const viaHook = props.useSession ? props.useSession((s) => s?.id ?? s?.sessionId) : void 0;
				const sessionId = props.sessionId ?? viaHook;
				const [info, setInfo] = (0, react.useState)(null);
				const [open, setOpen] = (0, react.useState)(true);
				(0, react.useEffect)(() => {
					let dead = false;
					const id = sessionId;
					if (!id) return;
					const load = () => {
						getSession(id).then((r) => {
							if (!dead) setInfo(r);
						}).catch(() => {
							if (!dead) setInfo(null);
						});
					};
					load();
					const t = setInterval(load, 8e3);
					return () => {
						dead = true;
						clearInterval(t);
					};
				}, [sessionId]);
				if (!info?.card) return null;
				const mem = info.memory ?? [];
				const readN = mem.filter((m) => m.read).length;
				const fresh = mem.length - readN;
				const head = !mem.length ? "这张卡片没有关联落盘项目，会话不读取记忆" : (fresh ? "已自动读取 " + fresh + " 个落盘项目的记忆" : "关联的落盘项目本会话都读过了") + (readN ? "，" + readN + " 个已读过不重复读取" : "");
				return (0, react.createElement)("div", { className: "dpm-dock" + (open ? " open" : "") }, (0, react.createElement)("button", {
					type: "button",
					className: "dock-h",
					"aria-expanded": open,
					onClick: () => setOpen(!open)
				}, (0, react.createElement)("span", {
					className: "grow",
					title: info.card.group + " / " + info.card.title,
					dangerouslySetInnerHTML: { __html: ic("mem") + esc(head) }
				}), mem.length ? (0, react.createElement)("span", {
					className: "chev",
					dangerouslySetInnerHTML: { __html: ic("chev") }
				}) : null), open && mem.length ? (0, react.createElement)("ul", null, mem.map((m) => (0, react.createElement)("li", { key: m.key }, (0, react.createElement)("b", null, m.slug), (0, react.createElement)("span", null, m.read ? "本会话已读过，不重复读取" : m.found ? m.next || "暂无下一步" : "未找到 STATE")))) : null);
			};
			ctx.effect(() => ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "dsh-project-manager:memory",
				order: 30
			}, Dock)), "dsh-project-manager: memory dock");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map