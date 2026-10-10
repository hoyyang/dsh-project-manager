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
			archive: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"4\" rx=\"1\"/><path d=\"M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4\"/>",
			unarchive: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"4\" rx=\"1\"/><path d=\"M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8\"/><path d=\"m9.5 14.5 2.5-2.5 2.5 2.5M12 12v5\"/>",
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
			info: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v6M12 7.5h.01\"/>",
			grip: "<g fill=\"currentColor\" stroke=\"none\"><circle cx=\"9\" cy=\"6\" r=\"1.6\"/><circle cx=\"15\" cy=\"6\" r=\"1.6\"/><circle cx=\"9\" cy=\"12\" r=\"1.6\"/><circle cx=\"15\" cy=\"12\" r=\"1.6\"/><circle cx=\"9\" cy=\"18\" r=\"1.6\"/><circle cx=\"15\" cy=\"18\" r=\"1.6\"/></g>",
			trash: "<path d=\"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3\"/>",
			chat: "<path d=\"M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.4A7.5 7.5 0 1 1 20 12z\"/>",
			file: "<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"/><path d=\"M14 3v5h5\"/>",
			filex: "<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"m10 12 4 4m0-4-4 4\"/>",
			note: "<path d=\"M5 4h14v16H5z\"/><path d=\"M9 9h6M9 13h6M9 17h3\"/>",
			refresh: "<path d=\"M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5\"/>",
			ext: "<path d=\"M14 4h6v6M20 4l-9 9\"/><path d=\"M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4\"/>"
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
		/** 与 dsh 官方「停止并归档」确认框同一套文案。 */
		function activityLine(a) {
			const items = a.items ?? [];
			const n = items.length;
			const names = items.map((x) => x.label ?? x.id).join("、");
			switch (a.kind) {
				case "turn": return "进行中的回合";
				case "subagent": return n + " 个运行中的子智能体：" + names;
				case "job": return n + " 个后台任务：" + names;
				case "schedule": return n + " 条定时提醒：" + names;
				default: return n + " 项其他工作（" + a.kind + "）";
			}
		}
		/** 归档时长：今天 / N 天前。 */
		const daysAgo = (iso, now = Date.now()) => {
			const d = Math.floor((now - (Date.parse(iso ?? "") || now)) / 864e5);
			return d < 1 ? "今天" : d + " 天前";
		};
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
		/** 卡片已关联会话的展示顺序：活跃 → 已归档 → 已删除（找不到）；同类按更新时间新 → 旧（已删除保持关联时间新 → 旧）。 */
		function sortLinked(refs, idx) {
			const rank = (r) => {
				const v = idx.get(r.sessionId);
				return !v ? 2 : v.archived ? 1 : 0;
			};
			const at = (r) => idx.get(r.sessionId)?.updatedAt ?? (Date.parse(r.createdAt ?? "") || 0);
			return refs.slice().sort((a, b) => rank(a) - rank(b) || at(b) - at(a));
		}
		/** 详情原地更新后找回焦点：优先 id，其次第一个 data-* 属性。 */
		const keyOf = (el) => {
			if (el.id) return "#" + CSS.escape(el.id);
			for (const a of Array.from(el.attributes)) if (a.name.startsWith("data-")) return "[" + a.name + "=\"" + CSS.escape(a.value) + "\"]";
			return null;
		};
		/** 与 dsh 添加工作区的默认标题同一规则：去掉末尾分隔符，取最后一段。 */
		const folderName = (p) => {
			const t = p.replace(/[/\\]+$/, "");
			return t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1);
		};
		const normPath = (p) => p.replace(/[/\\]+$/, "") || "/";
		/** 卡片有没有会注入会话的「卡片资料」（说明 / 链接 / 文件）。 */
		const hasMaterials = (c) => !!(c.notes ?? "").trim() || !!(c.webLinks ?? []).length || !!(c.files ?? []).length;
		/** 前端即时校验（与服务端 normUrl 同口径）：只收 http(s)；没写协议但像域名 → 补 https://。 */
		function checkUrl(v) {
			let s = v.trim();
			if (!s) return { err: "请填写完整链接" };
			if (/\s/.test(s)) return { err: "链接里不能有空格或换行" };
			if (!/^https?:\/\//i.test(s)) {
				if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d/.test(s)) return { err: "只支持 http:// 或 https:// 开头的链接" };
				if (!/^[^/]+\.[^/]+/.test(s) && !/^localhost(:|\/|$)/i.test(s)) return { err: "不像网址，请填 https:// 开头的完整链接" };
				s = "https://" + s;
			}
			try {
				const u = new URL(s);
				if (!u.hostname.includes(".") && u.hostname !== "localhost" && !u.hostname.startsWith("[")) return { err: "域名不完整：" + u.hostname };
				return { url: u.href };
			} catch {
				return { err: "链接格式不对" };
			}
		}
		const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?，。；：！？）)\]]/g, (u) => "<a href=\"" + u + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + u + "</a>");
		/** 卡片上的会话标志：已删除（dsh 里找不到）的不算；返回总数与活跃数，没有会话 = null。 */
		function sessBadge(refs, idx) {
			let n = 0, live = 0;
			for (const r of refs) {
				const v = idx.get(r.sessionId);
				if (!v) continue;
				n++;
				if (!v.archived) live++;
			}
			return n ? {
				n,
				live
			} : null;
		}
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
			/** 相关说明编辑态（card = 正在编辑的卡片，draft = 草稿）；没保存过的卡片始终是输入框。 */
			noteEdit = null;
			/** 相关文件：系统选文件框打开中 / 降级为手输路径。 */
			filePicking = false;
			fileManual = false;
			chipSig = "";
			/** 展开了「已归档卡片」列表的卡片组（默认全部收起，只在本次打开期间记住）。 */
			tray = /* @__PURE__ */ new Set();
			/** 等待「停止并归档」确认的会话。 */
			sa = null;
			/** 0.10：展开了完整「相关说明」的卡片（本次打开期间记住）。 */
			noteOpen = /* @__PURE__ */ new Set();
			/** 0.11：「关联的落盘项目」是否展开详情（全部卡片共用一个开关，本次打开期间记住，默认只显示标题）。 */
			memOpen = false;
			/** 0.10：「添加 / 编辑相关链接」弹窗草稿。 */
			wl = null;
			/** 0.10：相关链接拖动排序（pointer：按住手柄拖动，松开落位，Esc 取消）。 */
			wd = null;
			constructor(root, host) {
				this.root = root;
				this.host = host;
				root.classList.add("dpm");
				root.innerHTML = "<div class=\"pm-top\"></div><div class=\"pm-body\"><div class=\"board-wrap\"></div></div>" + DIALOGS.replace("%FOLDER%", ic("fplus")).replace("%PLUS%", ic("plus"));
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
				return this.cards.filter((c) => c.g === g && c.col === col && !c.archivedAt).sort((a, b) => a.order - b.order);
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
					if (quiet && (this.composing || this.gd)) return;
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
				const wrap = this.root.querySelector(".pm-body").querySelector(".board-wrap");
				const scroll = wrap.scrollTop;
				const addFocus = document.activeElement?.id === "dpmAddIn";
				this.rendering = true;
				const laneX = /* @__PURE__ */ new Map();
				wrap.querySelectorAll(".lane-in[data-g]").forEach((el) => laneX.set(el.dataset.g, el.scrollLeft));
				this.idxCache = this.sessIndex();
				try {
					wrap.innerHTML = (this.err ? "<div class=\"dpm-err\" role=\"alert\">" + esc(this.err) + "</div>" : "") + this.boardHtml();
				} finally {
					this.idxCache = null;
				}
				this.chipSig = this.chipSignature();
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
				this.renderDetail();
				this.rendering = false;
			}
			/**
			* 详情栏：换卡片 = 新插入（播放滑入）；同一张卡片 = 内容没变不动，变了就原地替换内容
			* （不重新插入节点、不重放动画，保留滚动、子任务草稿与焦点）——会话推送很频繁，整块重建会「闪」。
			*/
			lastDetail = "";
			renderDetail() {
				const body = this.root.querySelector(".pm-body");
				const old = body.querySelector(".detail");
				if (!this.sel || !this.card(this.sel)) {
					this.sel = null;
					old?.remove();
					this.lastDetail = "";
					return;
				}
				const html = this.detailHtml();
				if (old && old.getAttribute("data-card") === this.sel) {
					if (html === this.lastDetail) return;
					if (document.activeElement?.id === "dpmNoteIn" && old.contains(document.activeElement)) return;
					const tpl = document.createElement("template");
					tpl.innerHTML = html;
					const nd = tpl.content.firstElementChild;
					const scroll = old.querySelector(".d-b")?.scrollTop ?? 0;
					const task = old.querySelector("#dpmNewTask")?.value ?? "";
					const focusId = old.contains(document.activeElement) ? keyOf(document.activeElement) : null;
					old.classList.add("stay");
					old.replaceChildren(...Array.from(nd.childNodes));
					const db = old.querySelector(".d-b");
					if (db) db.scrollTop = scroll;
					const inp = old.querySelector("#dpmNewTask");
					if (inp && task) inp.value = task;
					if (focusId) old.querySelector(focusId)?.focus({ preventScroll: true });
				} else {
					old?.remove();
					body.insertAdjacentHTML("beforeend", html);
				}
				this.lastDetail = html;
				this.fixNotes();
			}
			/** 相关说明超过高度阈值 → 折叠（底部渐隐）+ 「展开全部 / 收起」；是否超长在渲染后量。 */
			fixNotes() {
				this.root.querySelectorAll(".detail [data-nwrap]").forEach((w) => {
					const v = w.querySelector(".note-view");
					const b = w.querySelector(".note-more");
					const long = v.scrollHeight > 184;
					w.classList.toggle("clamp", long && !this.noteOpen.has(w.dataset.nwrap));
					b.hidden = !long;
				});
			}
			boardHtml() {
				if (!this.snap) return "<div class=\"empty-board\"><span>加载中…</span></div>";
				if (!this.groups.length) return "<div class=\"empty-board\"><b>还没有卡片组</b><span>新建一个卡片组，或从落盘项目导入。</span><button type=\"button\" class=\"btn primary\" data-new-group>" + ic("plus") + "新建卡片组</button></div>";
				const q = this.q;
				const vis = this.cards.filter((c) => !c.archivedAt).filter((c) => !q || (c.t + " " + c.links.join(" ") + " " + this.cardDesc(c) + " " + (this.grp(c.g)?.repos.map((r) => r.name).join(" ") ?? "")).toLowerCase().includes(q));
				return this.groups.map((g) => {
					const cs = vis.filter((c) => c.g === g.id);
					const ar = this.cards.filter((c) => c.g === g.id && c.archivedAt).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
					const open = this.tray.has(g.id);
					const n = g.statuses.length;
					const head = "<div class=\"shead\" style=\"--cols:" + n + "\">" + g.statuses.map((st) => "<div class=\"colh\"><span class=\"nm\">" + esc(st.name) + "</span><span class=\"n\">" + cs.filter((x) => x.col === st.id).length + "</span></div>").join("") + "</div>";
					const bodyHtml = g.statuses.map((st) => {
						const inCol = cs.filter((c) => c.col === st.id).sort((a, b) => a.order - b.order);
						return "<div class=\"cell" + (inCol.length ? "" : " empty") + "\" data-col=\"" + esc(st.id) + "\" data-g=\"" + esc(g.id) + "\">" + inCol.map((c) => this.cardHtml(c)).join("") + this.addHtml(g, st) + "</div>";
					}).join("");
					return "<section class=\"lane" + (g.collapsed ? " collapsed" : "") + "\" data-lane=\"" + esc(g.id) + "\"><div class=\"lane-h\"><div class=\"lane-hit\" data-toggle-area=\"" + esc(g.id) + "\"><h2><button type=\"button\" class=\"tg\" data-toggle=\"" + esc(g.id) + "\" aria-expanded=\"" + !g.collapsed + "\"><span class=\"chev-b\"><svg class=\"i chev\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m6 9 6 6 6-6\"/></svg></span><span class=\"nm\">" + esc(g.name) + "</span></button></h2><span class=\"meta\">" + g.repos.length + " 个仓库 · " + cs.length + " 张卡片 · " + n + " 个阶段</span>" + (g.links.length ? "<button type=\"button\" class=\"chip mem as-btn\" data-edit-group=\"" + esc(g.id) + "\" data-focus-links>" + ic("mem") + "组记忆 " + g.links.length + "</button>" : "") + "</div><button type=\"button\" class=\"btn ghost\" data-edit-group=\"" + esc(g.id) + "\">" + ic("sliders") + "卡片组设置</button><button type=\"button\" class=\"btn ghost\" data-new-in=\"" + esc(g.id) + "\">" + ic("plus") + "新会话</button><button type=\"button\" class=\"btn ghost\" data-tray=\"" + esc(g.id) + "\" aria-expanded=\"" + open + "\" aria-controls=\"dpmTray-" + esc(g.id) + "\">" + ic("archive") + "已归档卡片<span class=\"cnt\">" + ar.length + "</span></button><button type=\"button\" class=\"ib grip tipbtn\" data-gdrag=\"" + esc(g.id) + "\" aria-label=\"调整「" + esc(g.name) + "」的顺序：按住拖动，或 Alt+上下方向键\">" + ic("grip") + "<span class=\"tip\" aria-hidden=\"true\">按住拖动排序</span></button></div>" + (open ? this.trayHtml(g, ar) : "") + "<div class=\"lane-in\" data-g=\"" + esc(g.id) + "\">" + head + "<div class=\"lane-b\" style=\"--cols:" + n + "\">" + bodyHtml + "</div></div></section>";
				}).join("");
			}
			/** 阶段底部的「添加卡片」：按钮，或正在输入时的就地表单。 */
			addHtml(g, st) {
				const a = this.adding;
				if (a && a.g === g.id && a.col === st.id) return "<form class=\"addc-f\" data-addcard><label class=\"sr-only\" for=\"dpmAddIn\">在「" + esc(st.name) + "」添加卡片</label><input id=\"dpmAddIn\" placeholder=\"卡片标题，回车添加\" autocomplete=\"off\" maxlength=\"120\" value=\"" + esc(this.addDraft) + "\"><span class=\"hint\">回车添加，可连续输入 · Esc 收起</span></form>";
				return "<button type=\"button\" class=\"addc\" data-add-card=\"" + esc(g.id) + "\" data-col=\"" + esc(st.id) + "\" aria-label=\"在「" + esc(st.name) + "」添加卡片\">" + ic("plus") + "添加卡片</button>";
			}
			cardHtml(c) {
				const n = this.memOf(c).length;
				const mem = n ? "<span class=\"chip mem\" title=\"会话会自动读取 " + n + " 个落盘项目的记忆\">" + ic("mem") + n + "<span class=\"sr-only\"> 个落盘项目</span></span>" : "";
				const sb = this.badgeOf(c.id);
				const tip = sb ? sb.live ? sb.live + " 个活跃会话" + (sb.n > sb.live ? "，" + (sb.n - sb.live) + " 个已归档" : "") : sb.n + " 个会话，都已归档" : "";
				const sess = sb ? "<span class=\"chip sess " + (sb.live ? "on" : "off") + "\" title=\"" + tip + "\"><span class=\"bub\">" + ic("chat") + "<i></i></span>" + sb.n + "<span class=\"sr-only\">，" + tip + "</span></span>" : "";
				const arc = "<button type=\"button\" class=\"ib carc tipbtn\" data-archive-card=\"" + esc(c.id) + "\" aria-label=\"归档卡片「" + esc(c.t) + "」\">" + ic("archive") + "<span class=\"tip\" aria-hidden=\"true\">归档卡片</span></button>";
				return "<div class=\"card\" role=\"button\" tabindex=\"0\" draggable=\"true\" data-card=\"" + esc(c.id) + "\" aria-pressed=\"" + (this.sel === c.id) + "\" aria-label=\"" + esc(c.t) + "，打开详情；Alt+上下方向键调整顺序\">" + arc + "<h3>" + esc(c.t) + "</h3><p>" + esc(this.cardDesc(c)) + "</p><div class=\"foot\">" + sess + mem + "</div></div>";
			}
			detailHtml() {
				const c = this.card(this.sel);
				const g = this.grp(c.g);
				const sts = g.statuses;
				const i = sts.findIndex((x) => x.id === c.col);
				const nx = sts[i + 1];
				const ro = !!c.archivedAt;
				const steps = sts.map((s, k) => "<button type=\"button\" class=\"step" + (k < i ? " past" : k === i ? " cur" : "") + "\"" + (ro ? " disabled" : " data-step=\"" + esc(s.id) + "\"") + (k === i ? " aria-current=\"step\"" : "") + " aria-label=\"移到 " + esc(s.name) + "\"><span class=\"nd\">" + (k < i ? ic("check") : "") + "</span>" + esc(s.name) + "</button>").join("");
				const mem = this.memOf(c);
				const memRows = mem.map((m) => {
					const s = this.stateOf(m.k);
					const tag = m.from === "group" ? "<span class=\"chip plain\">来自卡片组</span>" : m.from === "both" ? "<span class=\"chip plain\">卡片组 + 卡片</span>" : "<span class=\"chip brand\">卡片</span>";
					const rm = !ro && m.from !== "group" ? "<button type=\"button\" class=\"ib\" data-unlink-card=\"" + esc(m.k) + "\" aria-label=\"取消关联 " + esc(m.k) + "\">" + ic("x") + "</button>" : "";
					if (!s) return "<div class=\"mrow\"><div class=\"txt\"><div class=\"nm\" title=\"" + esc(m.k) + "\">" + esc(m.k) + "</div><div class=\"more\"><p class=\"l\">未找到这个落盘项目的 STATE（可能已移动或删除）</p></div></div><div class=\"mside\">" + tag + rm + "</div></div>";
					return "<div class=\"mrow\"><div class=\"txt\"><div class=\"nm\" title=\"" + esc(s.slug) + "\">" + esc(s.slug) + "</div><div class=\"more\"><span class=\"mono\">" + esc(s.project) + " · 更新于 " + esc(s.updated) + "</span><p class=\"l\">" + esc(s.status || "暂无状态说明") + "</p><p class=\"nx\"><b>next_action</b>" + esc(s.next || "暂无下一步") + "</p></div></div><div class=\"mside\">" + tag + rm + "</div></div>";
				}).join("");
				const memBody = memRows ? "<div class=\"mlist" + (this.memOpen ? " open" : "") + "\" id=\"dpmMemList\">" + memRows + "</div>" : "<p class=\"meta\">还没有关联落盘项目。会话不会自动读取任何记忆。</p>";
				const memTg = memRows ? "<button type=\"button\" class=\"btn ghost sm mem-tg\" data-mem-toggle aria-expanded=\"" + this.memOpen + "\" aria-controls=\"dpmMemList\">" + (this.memOpen ? "收起详情" : "展开详情") + ic("chev") + "</button>" : "";
				const repos = g.repos.map((r) => "<div class=\"repo\">" + ic("repo") + "<div class=\"txt\"><div class=\"nm\">" + esc(r.name) + "</div><span class=\"mono\">" + esc(r.path) + "</span></div><span class=\"chip " + (r.role === "主仓" ? "brand" : "plain") + "\">" + esc(r.role) + "</span></div>").join("") || "<p class=\"meta\">未挂载仓库，在「卡片组设置」里添加。</p>";
				const tasks = c.tasks.map((t, k) => "<div class=\"task" + (t.done ? " done" : "") + "\"><label><input type=\"checkbox\"" + (ro ? " disabled" : " data-task=\"" + k + "\"") + (t.done ? " checked" : "") + "><span>" + esc(t.text) + "</span></label>" + (ro ? "" : "<button type=\"button\" class=\"ib sm\" data-task-del=\"" + k + "\" aria-label=\"删除子任务 " + esc(t.text) + "\">" + ic("x") + "</button>") + "</div>").join("");
				const sess = this.linkedHtml(c, ro);
				return "<aside class=\"detail" + (ro ? " ro" : "") + "\" data-card=\"" + esc(c.id) + "\" aria-labelledby=\"dpmDT\"><div class=\"d-h\"><div class=\"grow\" style=\"white-space:normal\"><h2 id=\"dpmDT\">" + esc(c.t) + "</h2><div class=\"sub\">" + esc(g.name) + " · " + esc(sts[i]?.name ?? "") + "</div></div>" + (ro ? "" : "<button type=\"button\" class=\"ib\" data-rename-card aria-label=\"重命名卡片\">" + ic("pencil") + "</button><button type=\"button\" class=\"ib tipbtn\" data-archive-card=\"" + esc(c.id) + "\" aria-label=\"归档这张卡片\">" + ic("archive") + "<span class=\"tip\" aria-hidden=\"true\">归档卡片</span></button>") + "<button type=\"button\" class=\"ib\" data-close aria-label=\"关闭详情\">" + ic("x") + "</button></div>" + (ro ? "<div class=\"arch-bar\"><span class=\"txt\"><b>已归档</b> · " + esc(daysAgo(c.archivedAt)) + "，只能查看</span><button type=\"button\" class=\"btn sm\" data-unarchive-card=\"" + esc(c.id) + "\">" + ic("unarchive") + "恢复活跃</button></div>" : "") + "<div class=\"d-b\"><section class=\"sec\"><h3>" + ic("play") + "本卡片的会话 · " + this.sessionsOf(c.id).length + "<span class=\"grow\"></span>" + (ro ? "" : "<button type=\"button\" class=\"btn ghost sm\" data-link-sess>" + ic("link") + "关联已有会话</button>") + "</h3>" + sess + "</section><section class=\"sec\"><h3>" + ic("mem") + "关联的落盘项目 · " + mem.length + "<span class=\"grow\"></span>" + memTg + (ro ? "" : "<button type=\"button\" class=\"btn ghost sm\" data-link-card>" + ic("plus") + "关联</button>") + "</h3>" + (ro ? "" : "<p class=\"meta mb\">会话会自动读取下面这些落盘项目的记忆。来自卡片组的在「卡片组设置」里改。</p>") + memBody + "</section>" + this.notesHtml(c, ro) + this.webLinksHtml(c, ro) + this.filesHtml(c, ro) + "<section class=\"sec\"><h3>阶段</h3><div class=\"steps\">" + steps + "</div>" + (ro ? "" : nx ? "<button type=\"button\" class=\"btn primary lg\" data-next>推进到 " + esc(nx.name) + ic("arrow") + "</button>" : "<p class=\"meta\">已在最后一个阶段</p>") + "</section><section class=\"sec\"><h3>子任务 " + c.tasks.filter((t) => t.done).length + "/" + c.tasks.length + "</h3>" + tasks + (ro ? c.tasks.length ? "" : "<p class=\"meta\">没有子任务。</p>" : "<form class=\"addtask\" data-addtask><label class=\"sr-only\" for=\"dpmNewTask\">新子任务</label><input id=\"dpmNewTask\" placeholder=\"添加子任务，回车确认\" autocomplete=\"off\"><button class=\"btn\" type=\"submit\">添加</button></form>") + "</section><section class=\"sec\"><h3>" + ic("repo") + "仓库（继承自卡片组）</h3>" + repos + "</section>" + (ro ? "</div></aside>" : "<section class=\"sec\"><button type=\"button\" class=\"btn ghost danger\" data-remove-card>" + ic("trash") + "删除这张卡片</button></section></div><div class=\"d-f\"><div class=\"note\"><span class=\"chip warn\">" + ic("shield") + "完全权限</span><span class=\"chip mem\">" + ic("mem") + "自动读取 " + mem.length + " 个落盘项目" + (hasMaterials(c) ? " + 卡片资料" : "") + "</span></div><button type=\"button\" class=\"btn primary lg\" data-open-card>" + ic("play") + "以此卡片新建会话</button></div></aside>");
			}
			/** 「已归档卡片」列表：就地展开在卡片组头部下方；一行 = 名称 + 灰字信息，点行看只读详情，行尾图标恢复活跃。 */
			trayHtml(g, ar) {
				const idx = this.idxCache ?? this.sessIndex();
				const rows = ar.map((c) => {
					const ns = (this.snap?.board.sessions ?? []).filter((s) => s.cardId === c.id && idx.has(s.sessionId)).length;
					const nm = this.memOf(c).length;
					const sub = [
						this.st(g, c.col)?.name ?? "",
						daysAgo(c.archivedAt) + "归档",
						ns ? ns + " 个会话" : "",
						nm ? nm + " 个落盘项目" : ""
					].filter(Boolean).join(" · ");
					return "<div class=\"arow\" role=\"button\" tabindex=\"0\" data-card=\"" + esc(c.id) + "\" aria-current=\"" + (this.sel === c.id) + "\" aria-label=\"查看「" + esc(c.t) + "」（已归档，只读）\"><span class=\"txt\"><span class=\"nm\">" + esc(c.t) + "</span><span class=\"sub\">" + esc(sub) + "</span></span><button type=\"button\" class=\"ib rst tipbtn\" data-unarchive-card=\"" + esc(c.id) + "\" aria-label=\"恢复活跃「" + esc(c.t) + "」\">" + ic("unarchive") + "<span class=\"tip\" aria-hidden=\"true\">恢复活跃</span></button></div>";
				}).join("") || "<p class=\"atray-empty\">还没有已归档的卡片。点卡片右上角的归档按钮，或把卡片拖到这里。</p>";
				return "<div class=\"atray\" id=\"dpmTray-" + esc(g.id) + "\" data-tray-g=\"" + esc(g.id) + "\" role=\"region\" aria-label=\"「" + esc(g.name) + "」的已归档卡片\"><div class=\"atray-h\">已归档 " + ar.length + "<span class=\"grow\"></span><button type=\"button\" class=\"ib sm\" data-tray=\"" + esc(g.id) + "\" aria-label=\"收起已归档卡片\">" + ic("x") + "</button></div><div class=\"atray-l\"><div class=\"atray-drop\" aria-hidden=\"true\">松开即归档</div>" + rows + "</div></div>";
			}
			/** 归档卡片：卡片淡出后再提交；提示里可撤销。会话不动。 */
			async archiveCard(id) {
				const c = this.card(id);
				if (!c || c.archivedAt) return;
				const el = this.root.querySelector(".card[data-card=\"" + CSS.escape(id) + "\"]");
				if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
					el.classList.add("leaving");
					await new Promise((r) => setTimeout(r, 200));
				}
				if (!await this.act("card/archive", { id })) return;
				this.host.toast("已归档「" + c.t + "」", "ok", {
					label: "撤销",
					run: () => void this.act("card/unarchive", { id }, "已撤销归档")
				});
				const row = this.root.querySelector(".arow[data-card=\"" + CSS.escape(id) + "\"]");
				if (row) {
					row.classList.add("landed");
					setTimeout(() => row.classList.remove("landed"), 700);
				}
			}
			/** 恢复活跃：行滑出后提交，卡片回到原阶段末尾并闪一下。 */
			async unarchiveCard(id) {
				const c = this.card(id);
				if (!c || !c.archivedAt) return;
				const row = this.root.querySelector(".arow[data-card=\"" + CSS.escape(id) + "\"]");
				if (row && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
					row.classList.add("leaving");
					await new Promise((r) => setTimeout(r, 200));
				}
				if (!await this.act("card/unarchive", { id })) return;
				const now = this.card(id);
				const g = now ? this.grp(now.g) : void 0;
				this.host.toast("已恢复「" + c.t + "」到「" + (g && now ? this.st(g, now.col)?.name ?? "" : "") + "」");
				const el = this.root.querySelector(".card[data-card=\"" + CSS.escape(id) + "\"]");
				if (el) {
					el.scrollIntoView({
						block: "nearest",
						inline: "nearest"
					});
					el.classList.add("landed");
					setTimeout(() => el.classList.remove("landed"), 450);
				}
			}
			async toggleTray(gId) {
				const g = this.grp(gId);
				if (!g) return;
				if (this.tray.has(gId)) this.tray.delete(gId);
				else {
					this.tray.add(gId);
					if (g.collapsed && !await this.act("group/update", {
						id: gId,
						collapsed: false
					})) return;
				}
				this.render();
				this.root.querySelector(".lane-h [data-tray=\"" + CSS.escape(gId) + "\"]")?.focus({ preventScroll: true });
			}
			/** 归档会话：与 dsh 侧栏同一动作——空闲直接归档（可撤销）；有进行中的工作 → 「停止并归档此会话？」确认。 */
			async archiveSession(id) {
				const title = this.sessIndex().get(id)?.title ?? "会话";
				try {
					const r = await this.host.archiveSession(id, false);
					if (r.ok) {
						this.archivedToast(id, title, false);
						return;
					}
					this.sa = {
						id,
						title
					};
					this.$("#dpmSaP").textContent = "“" + title + "”仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏筛选“全部对话（显示已归档）”中恢复会话，被停止的工作不会自动继续。";
					this.$("#dpmSaL").innerHTML = r.activity.map((a) => "<li>" + esc(activityLine(a)) + "</li>").join("");
					const d = this.$("#dpmDlgSArc");
					d.returnValue = "";
					d.showModal();
					this.root.querySelector("#dpmDlgSArc [data-dlg-cancel]")?.focus();
				} catch (e) {
					this.host.toast("归档会话失败：" + (e instanceof Error ? e.message : String(e)), "err");
				}
			}
			async stopAndArchive(id, title) {
				try {
					await this.host.archiveSession(id, true);
					this.archivedToast(id, title, true);
				} catch (e) {
					this.host.toast("停止并归档失败：" + (e instanceof Error ? e.message : String(e)), "err");
				}
			}
			archivedToast(id, title, stopped) {
				this.host.toast((stopped ? "已停止并归档「" : "已归档「") + title + "」", "ok", {
					label: "撤销",
					run: () => {
						this.host.unarchiveSession(id).catch((e) => this.host.toast("撤销失败：" + (e instanceof Error ? e.message : String(e)), "err"));
					}
				});
			}
			/** 每张卡片的会话标志（一次渲染内复用会话索引）。 */
			idxCache = null;
			badgeOf(cardId) {
				const idx = this.idxCache ?? this.sessIndex();
				return sessBadge((this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId), idx);
			}
			chipSignature() {
				this.idxCache = this.sessIndex();
				try {
					return this.cards.map((c) => {
						const b = this.badgeOf(c.id);
						return b ? b.n + ":" + (b.live ? 1 : 0) : "-";
					}).join(",");
				} finally {
					this.idxCache = null;
				}
			}
			/** 相关说明：没保存过 = 输入框；保存过 = 只读展示（网址可点）+ 编辑按钮。 */
			notesHtml(c, ro = false) {
				const saved = c.notes ?? "";
				if (ro) return "<section class=\"sec\"><h3>" + ic("note") + "相关说明</h3>" + (saved ? this.noteView(c, saved) : "<p class=\"meta\">没有填写说明。</p>") + "</section>";
				const ed = this.noteEdit && this.noteEdit.card === c.id ? this.noteEdit : null;
				const editing = !saved || !!ed;
				const head = "<h3>" + ic("note") + "相关说明<span class=\"grow\"></span>" + (editing ? "" : "<button type=\"button\" class=\"btn ghost sm\" data-note-edit>" + ic("pencil") + "编辑</button>") + "</h3>";
				if (!editing) return "<section class=\"sec\">" + head + this.noteView(c, saved) + "</section>";
				const draft = ed ? ed.draft : saved;
				const dirty = draft !== saved;
				return "<section class=\"sec\">" + head + "<label class=\"sr-only\" for=\"dpmNoteIn\">相关说明</label><textarea class=\"note-in\" id=\"dpmNoteIn\" placeholder=\"写下和这个项目相关的任何说明：背景、约定、网址链接……不限字数\">" + esc(draft) + "</textarea><div class=\"note-bar\"><span class=\"meta\" id=\"dpmNoteN\">" + draft.length + " 字" + (saved ? " · 编辑中" : "") + "</span><span class=\"grow\"></span><button type=\"button\" class=\"btn sm\" data-note-reset" + (dirty ? "" : " disabled") + " title=\"" + (saved ? "恢复成上次保存的内容" : "清空输入") + "\">重置</button><button type=\"button\" class=\"btn primary sm\" data-note-save" + (dirty ? "" : " disabled") + ">保存</button></div></section>";
			}
			noteView(c, saved) {
				const open = this.noteOpen.has(c.id);
				return "<div class=\"note-wrap\" data-nwrap=\"" + esc(c.id) + "\"><div class=\"note-view\">" + linkify(saved) + "</div><button type=\"button\" class=\"btn ghost sm note-more\" data-note-more=\"" + esc(c.id) + "\" aria-expanded=\"" + open + "\" hidden>" + (open ? "收起" : "展开全部") + ic("chev") + "</button></div>";
			}
			/** 0.10 相关链接：完整列表（不折叠）；一行 = 拖动手柄 + 显示文字（点开 = 默认浏览器）+ 类型 + 编辑 / 删除。 */
			webLinksHtml(c, ro = false) {
				const ls = c.webLinks ?? [];
				const rows = ls.map((l, k) => "<div class=\"wl\" data-wl=\"" + k + "\">" + (ro ? "" : "<button type=\"button\" class=\"wgrip\" data-wdrag=\"" + k + "\" aria-label=\"拖动调整「" + esc(l.text) + "」的位置（键盘 Alt+上下方向键）\">" + ic("grip") + "</button>") + "<a class=\"wl-a" + (ro ? " ro" : "") + "\" href=\"" + esc(l.url) + "\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"" + esc(l.url) + "\">" + ic("ext") + "<span class=\"t\">" + esc(l.text) + "</span></a><span class=\"chip plain\">" + esc(l.type) + "</span>" + (ro ? "" : "<span class=\"acts\"><button type=\"button\" class=\"ib sm tipbtn\" data-wl-edit=\"" + k + "\" aria-label=\"编辑 " + esc(l.text) + "\">" + ic("pencil") + "<span class=\"tip\" aria-hidden=\"true\">编辑</span></button><button type=\"button\" class=\"ib sm del tipbtn\" data-wl-del=\"" + k + "\" aria-label=\"删除 " + esc(l.text) + "\">" + ic("trash") + "<span class=\"tip\" aria-hidden=\"true\">删除</span></button></span>") + "</div>").join("");
				const body = ls.length ? "<div class=\"wl-list\">" + rows + "</div>" : "<p class=\"meta\">" + (ro ? "没有相关链接。" : "还没有相关链接。点「添加链接」可以一次加多条。") + "</p>";
				return "<section class=\"sec\"><h3>" + ic("link") + "相关链接 · " + ls.length + "<span class=\"grow\"></span>" + (ro ? "" : "<button type=\"button\" class=\"btn ghost sm\" data-wl-add>" + ic("plus") + "添加链接</button>") + "</h3>" + body + "</section>";
			}
			get linkTypes() {
				return this.snap?.board.linkTypes ?? ["文档", "代码"];
			}
			blankRow(type) {
				return {
					text: "",
					type: type ?? this.linkTypes[0],
					url: "",
					err: "",
					tnew: false,
					tdraft: ""
				};
			}
			wlOpen(c, mode, idx = -1) {
				const l = mode === "edit" ? (c.webLinks ?? [])[idx] : void 0;
				if (mode === "edit" && !l) return;
				this.wl = {
					card: c.id,
					mode,
					idx,
					rows: [l ? {
						...l,
						err: "",
						tnew: false,
						tdraft: ""
					} : this.blankRow()]
				};
				this.$("#dpmWlT").textContent = mode === "edit" ? "编辑链接" : "添加相关链接";
				this.$("#dpmWlP").textContent = mode === "edit" ? "改完点保存。" : "可以一次加多条；在「完整链接」里粘贴多行网址会自动拆成多条。";
				this.$("#dpmWlMore").hidden = mode === "edit";
				this.wlRender();
				const d = this.$("#dpmDlgWl");
				d.returnValue = "";
				d.showModal();
				this.root.querySelector("#dpmWlRows [data-wurl]")?.focus();
			}
			wlTypeCtl(r, i) {
				if (r.tnew) return "<div class=\"wl-tnew\"><label class=\"sr-only\" for=\"dpmWtn" + i + "\">新类型名称</label><input class=\"fld\" id=\"dpmWtn" + i + "\" data-wtnew=\"" + i + "\" value=\"" + esc(r.tdraft) + "\" placeholder=\"新类型名称\" maxlength=\"20\" autocomplete=\"off\"><button type=\"button\" class=\"btn sm\" data-wt-ok=\"" + i + "\">确定</button></div>";
				const ts = this.linkTypes.includes(r.type) ? this.linkTypes : [...this.linkTypes, r.type];
				return "<select class=\"fld\" id=\"dpmWt" + i + "\" data-wtype=\"" + i + "\">" + ts.map((t) => "<option" + (t === r.type ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "<option value=\"__new\">＋ 新增类型…</option></select>";
			}
			wlRender() {
				const w = this.wl;
				if (!w) return;
				const rows = w.rows;
				this.$("#dpmWlRows").innerHTML = rows.map((r, i) => "<div class=\"wl-row\">" + (rows.length > 1 ? "<div class=\"wl-row-h\">第 " + (i + 1) + " 条<span class=\"grow\"></span><button type=\"button\" class=\"ib sm\" data-wl-rm=\"" + i + "\" aria-label=\"移除第 " + (i + 1) + " 条\">" + ic("x") + "</button></div>" : "") + "<div class=\"wl-grid\"><div><label class=\"lbl\" for=\"dpmWx" + i + "\">显示文字</label><input class=\"fld\" id=\"dpmWx" + i + "\" data-wtext=\"" + i + "\" value=\"" + esc(r.text) + "\" placeholder=\"不填就用网址\" maxlength=\"120\" autocomplete=\"off\"></div><div><label class=\"lbl\" for=\"" + (r.tnew ? "dpmWtn" : "dpmWt") + i + "\">类型</label>" + this.wlTypeCtl(r, i) + "</div><div class=\"full\"><label class=\"lbl\" for=\"dpmWu" + i + "\">完整链接</label><input class=\"fld" + (r.err ? " bad" : "") + "\" id=\"dpmWu" + i + "\" data-wurl=\"" + i + "\" value=\"" + esc(r.url) + "\" placeholder=\"https://…\" autocomplete=\"off\" inputmode=\"url\"" + (r.err ? " aria-invalid=\"true\" aria-describedby=\"dpmWe" + i + "\"" : "") + ">" + (r.err ? "<p class=\"wl-err\" id=\"dpmWe" + i + "\">" + esc(r.err) + "</p>" : "") + "</div></div></div>").join("");
				this.$("#dpmWlCount").textContent = w.mode === "add" && rows.length > 1 ? "共 " + rows.length + " 条，空行不保存" : "";
				this.wlOkText();
			}
			wlOkText() {
				const w = this.wl;
				if (!w) return;
				const n = w.rows.filter((r) => r.url.trim()).length;
				this.$("#dpmWlOk").textContent = w.mode === "add" && n > 1 ? "保存 " + n + " 条" : "保存";
			}
			/** 新增全局类型：立刻存到服务端（任意卡片都能选），本条选上它。 */
			async wlAddType(i) {
				const w = this.wl;
				const r = w?.rows[i];
				if (!w || !r) return;
				const v = r.tdraft.trim();
				r.tnew = false;
				r.tdraft = "";
				if (v) {
					const had = this.linkTypes.includes(v);
					try {
						const res = await post("linktype/add", { name: v });
						if (this.disposed) return;
						this.snap = res;
						r.type = res.result;
						this.render();
						if (!had) this.host.toast("已新增类型「" + res.result + "」，所有卡片都能选");
					} catch (e) {
						this.host.toast("新增类型失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
					}
				}
				if (this.wl !== w) return;
				this.wlRender();
				this.root.querySelector("#dpmWt" + i)?.focus();
			}
			async wlSave() {
				const w = this.wl;
				const c = w ? this.card(w.card) : void 0;
				if (!w || !c) return;
				for (let i = 0; i < w.rows.length; i++) if (w.rows[i].tnew) await this.wlAddType(i);
				const rows = w.rows.filter((r) => w.mode === "edit" || r.text.trim() || r.url.trim());
				if (!rows.length) {
					this.$("#dpmDlgWl").close("");
					return;
				}
				let bad = 0;
				for (const r of rows) {
					const v = checkUrl(r.url);
					r.err = v.err ?? "";
					if (v.err) bad++;
					else r.url = v.url;
				}
				w.rows = rows;
				if (bad) {
					this.wlRender();
					this.root.querySelector("#dpmWlRows .fld.bad")?.focus();
					return;
				}
				const items = rows.map((r) => ({
					text: r.text.trim(),
					type: r.type,
					url: r.url
				}));
				const cur = (c.webLinks ?? []).slice();
				if (w.mode === "edit") cur[w.idx] = items[0];
				else cur.push(...items);
				if (!await this.act("card/weblinks", {
					id: c.id,
					links: cur
				}, w.mode === "edit" ? "已保存链接" : "已添加 " + items.length + " 条相关链接")) return;
				this.wl = null;
				this.$("#dpmDlgWl").close("ok");
			}
			async wlMove(c, i, j) {
				const ls = (c.webLinks ?? []).slice();
				if (j < 0 || j >= ls.length || i === j) return;
				const [x] = ls.splice(i, 1);
				ls.splice(j, 0, x);
				if (!await this.act("card/weblinks", {
					id: c.id,
					links: ls
				}, "已调整链接顺序")) return;
				const row = this.root.querySelector(".detail [data-wl=\"" + j + "\"]");
				if (row) {
					row.classList.add("landed");
					setTimeout(() => row.classList.remove("landed"), 450);
				}
				this.root.querySelector(".detail [data-wdrag=\"" + j + "\"]")?.focus({ preventScroll: true });
			}
			async wlDelete(c, k) {
				const ls = (c.webLinks ?? []).slice();
				const [x] = ls.splice(k, 1);
				if (!x || !await this.act("card/weblinks", {
					id: c.id,
					links: ls
				})) return;
				this.host.toast("已删除「" + x.text + "」", "ok", {
					label: "撤销",
					run: () => {
						const now = (this.card(c.id)?.webLinks ?? []).slice();
						now.splice(Math.min(k, now.length), 0, x);
						this.act("card/weblinks", {
							id: c.id,
							links: now
						}, "已恢复「" + x.text + "」");
					}
				});
			}
			wdDown(e) {
				const h = e.target.closest?.("[data-wdrag]");
				if (!h || e.button !== 0) return false;
				e.preventDefault();
				h.setPointerCapture(e.pointerId);
				this.wd = {
					i: Number(h.dataset.wdrag),
					y0: e.clientY,
					on: false,
					to: void 0
				};
				return true;
			}
			wdMove(e) {
				const wd = this.wd;
				if (!wd) return;
				if (!wd.on) {
					if (Math.abs(e.clientY - wd.y0) < 4) return;
					wd.on = true;
					this.root.classList.add("wdragging");
					this.root.querySelector(".detail [data-wl=\"" + wd.i + "\"]")?.classList.add("lifting");
				}
				const rows = Array.from(this.root.querySelectorAll(".detail [data-wl]"));
				let to = rows.length;
				for (let k = 0; k < rows.length; k++) {
					const r = rows[k].getBoundingClientRect();
					if (e.clientY < r.top + r.height / 2) {
						to = k;
						break;
					}
				}
				this.root.querySelectorAll(".wins-before, .wins-after").forEach((n) => n.classList.remove("wins-before", "wins-after"));
				wd.to = to === wd.i || to === wd.i + 1 ? void 0 : to;
				if (wd.to !== void 0) (to < rows.length ? rows[to] : rows[rows.length - 1]).classList.add(to < rows.length ? "wins-before" : "wins-after");
			}
			wdStop(commit) {
				const wd = this.wd;
				if (!wd) return false;
				this.wd = null;
				this.root.classList.remove("wdragging");
				this.root.querySelectorAll(".wl.lifting, .wins-before, .wins-after").forEach((n) => n.classList.remove("lifting", "wins-before", "wins-after"));
				const c = this.sel ? this.card(this.sel) : void 0;
				if (commit && wd.on && wd.to !== void 0 && c) this.wlMove(c, wd.i, wd.to > wd.i ? wd.to - 1 : wd.to);
				return true;
			}
			syncNoteBar(c, v) {
				const dirty = v !== (c.notes ?? "");
				const r = this.root.querySelector("[data-note-reset]");
				const s = this.root.querySelector("[data-note-save]");
				const n = this.root.querySelector("#dpmNoteN");
				if (r) r.disabled = !dirty;
				if (s) s.disabled = !dirty;
				if (n) n.textContent = v.length + " 字" + (c.notes ? " · 编辑中" : "");
			}
			/** 相关文件：完整路径 + 存在/已删除 + 解除关联图标（只移出列表，不删文件）。 */
			filesHtml(c, ro = false) {
				const fs = c.files ?? [];
				const st = this.snap?.files ?? {};
				const rows = fs.map((p) => {
					const ok = st[p] !== false;
					return "<div class=\"frow-f" + (ok ? "" : " gone") + "\">" + ic(ok ? "file" : "filex") + "<div class=\"txt\"><div class=\"nm\">" + esc(folderName(p)) + "</div><span class=\"mono\">" + esc(p) + "</span>" + (ok ? "<span class=\"chip ok\">存在</span>" : "<span class=\"chip warn\">已删除</span>") + "</div>" + (ro ? "" : "<button type=\"button\" class=\"ib sm unl tipbtn\" data-file-unlink=\"" + esc(p) + "\" aria-label=\"解除关联 " + esc(p) + "\">" + ic("unlink") + "<span class=\"tip\" aria-hidden=\"true\">解除关联</span></button>") + "</div>";
				}).join("") || "<p class=\"meta\">" + (ro ? "没有相关文件。" : "还没有相关文件。点「添加文件」从系统里选，可多选。") + "</p>";
				if (ro) return "<section class=\"sec\"><h3>" + ic("file") + "相关文件 · " + fs.length + "</h3>" + rows + "</section>";
				const manual = this.fileManual ? "<form class=\"addtask\" data-addfile><label class=\"sr-only\" for=\"dpmFileIn\">文件的绝对路径</label><input id=\"dpmFileIn\" placeholder=\"输入文件的绝对路径，回车添加\" autocomplete=\"off\"><button class=\"btn\" type=\"submit\">添加</button></form>" : "";
				return "<section class=\"sec\"><h3>" + ic("file") + "相关文件 · " + fs.length + "<span class=\"grow\"></span><button type=\"button\" class=\"btn ghost sm\" data-file-add" + (this.filePicking ? " disabled" : "") + ">" + ic("plus") + (this.filePicking ? "选择中…" : "添加文件") + "</button></h3>" + rows + manual + "</section>";
			}
			async pickFiles(c) {
				if (this.filePicking) return;
				this.filePicking = true;
				this.renderDetail();
				try {
					const r = await post("card/files-pick", { id: c.id });
					if (this.disposed) return;
					this.snap = r;
					this.filePicking = false;
					this.render();
					if (!r.result.cancelled) this.host.toast(r.result.added ? "已添加 " + r.result.added + " 个相关文件" + (r.result.skipped ? "，" + r.result.skipped + " 个已关联过" : "") : "选的文件都已关联过");
				} catch (e) {
					this.filePicking = false;
					this.fileManual = true;
					this.render();
					console.warn("[dsh-project-manager] card/files-pick 失败，改为手输路径：", e);
					this.host.toast((e instanceof ApiError ? e.message : String(e)) + "。可以直接输入文件的绝对路径", "err");
					this.root.querySelector("#dpmFileIn")?.focus();
				}
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
				this.on(r, "pointerdown", (e) => {
					if (!this.wdDown(e)) this.gdDown(e);
				});
				this.on(r, "pointermove", (e) => {
					if (this.wd) this.wdMove(e);
					else this.gdMove(e);
				});
				this.on(r, "pointerup", () => {
					if (!this.wdStop(true)) this.gdStop(true);
				});
				this.on(r, "pointercancel", () => {
					if (!this.wdStop(false)) this.gdStop(false);
				});
				this.on(r, "lostpointercapture", () => {
					if (!this.wdStop(false)) this.gdStop(false);
				});
				this.on(r, "paste", (e) => this.onPaste(e));
				for (const id of [
					"dpmDlgSt",
					"dpmDlgName",
					"dpmDlgLink",
					"dpmDlgImp",
					"dpmDlgRepo",
					"dpmDlgSess",
					"dpmDlgCfm",
					"dpmDlgSArc",
					"dpmDlgWl"
				]) {
					const d = this.$("#" + id);
					this.on(d, "close", () => void this.onDialogClose(id, d));
				}
			}
			async onClick(e) {
				const t = e.target.closest("button, [role=\"button\"]");
				const area = e.target.closest("[data-toggle-area]");
				if (area && (!t || !area.contains(t))) return this.toggleGroup(area.dataset.toggleArea);
				if (!t || !this.root.contains(t)) return;
				const d = t.dataset;
				const c = this.sel ? this.card(this.sel) : void 0;
				if (d.dlgCancel !== void 0) {
					t.closest("dialog")?.close("cancel");
					return;
				}
				if (d.archiveCard) return this.archiveCard(d.archiveCard);
				if (d.unarchiveCard) return this.unarchiveCard(d.unarchiveCard);
				if (d.tray) return this.toggleTray(d.tray);
				if (d.archiveSess) return this.archiveSession(d.archiveSess);
				if (d.noteMore) {
					const id = d.noteMore;
					if (this.noteOpen.has(id)) this.noteOpen.delete(id);
					else this.noteOpen.add(id);
					this.lastDetail = "";
					this.renderDetail();
					const b = this.root.querySelector("[data-note-more=\"" + CSS.escape(id) + "\"]");
					if (b) {
						b.focus({ preventScroll: true });
						if (!this.noteOpen.has(id)) b.closest(".sec")?.scrollIntoView({ block: "nearest" });
					}
					return;
				}
				if (d.memToggle !== void 0) {
					this.memOpen = !this.memOpen;
					this.renderDetail();
					this.root.querySelector("[data-mem-toggle]")?.focus({ preventScroll: true });
					return;
				}
				if (d.wlAdd !== void 0 && c) return this.wlOpen(c, "add");
				if (d.wlEdit !== void 0 && c) return this.wlOpen(c, "edit", Number(d.wlEdit));
				if (d.wlDel !== void 0 && c) return this.wlDelete(c, Number(d.wlDel));
				if (d.wlMore !== void 0 && this.wl) {
					const last = this.wl.rows[this.wl.rows.length - 1];
					this.wl.rows.push(this.blankRow(last?.type));
					this.wlRender();
					this.root.querySelector("#dpmWx" + (this.wl.rows.length - 1))?.focus();
					return;
				}
				if (d.wlRm !== void 0 && this.wl) {
					this.wl.rows.splice(Number(d.wlRm), 1);
					this.wlRender();
					return;
				}
				if (d.wtOk !== void 0 && this.wl) return this.wlAddType(Number(d.wtOk));
				if (t.id === "dpmWlOk") return this.wlSave();
				if (d.card) {
					if (this.sel !== d.card) {
						this.noteEdit = null;
						this.fileManual = false;
					}
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
					this.noteEdit = null;
					this.fileManual = false;
					return this.render();
				}
				if (d.themeToggle !== void 0) {
					this.host.setDark(!this.host.isDark());
					return;
				}
				if (d.toggle) return this.toggleGroup(d.toggle);
				if (d.gdrag) return;
				if (d.newIn) return this.host.pickCard(t, d.newIn);
				if (d.openCard !== void 0 && c) return this.host.newSession(c.id);
				if (d.openSess) return this.host.openSession(d.openSess);
				if (d.linkSess !== void 0 && c) return this.openLinkSess(c);
				if (d.noteEdit !== void 0 && c) {
					this.noteEdit = {
						card: c.id,
						draft: c.notes ?? ""
					};
					this.renderDetail();
					const i = this.root.querySelector("#dpmNoteIn");
					if (i) {
						i.focus();
						i.setSelectionRange(i.value.length, i.value.length);
					}
					return;
				}
				if (d.noteReset !== void 0 && c) {
					this.noteEdit = c.notes ? {
						card: c.id,
						draft: c.notes
					} : null;
					this.lastDetail = "";
					this.renderDetail();
					this.root.querySelector("#dpmNoteIn")?.focus();
					this.host.toast(c.notes ? "已恢复成上次保存的内容" : "已清空");
					return;
				}
				if (d.noteSave !== void 0 && c) {
					const v = this.noteEdit && this.noteEdit.card === c.id ? this.noteEdit.draft : this.root.querySelector("#dpmNoteIn")?.value ?? "";
					const prev = this.noteEdit;
					this.noteEdit = null;
					if (!await this.act("card/notes", {
						id: c.id,
						notes: v
					}, v.trim() ? "相关说明已保存" : "已清空相关说明")) {
						this.noteEdit = prev ?? {
							card: c.id,
							draft: v
						};
						this.renderDetail();
					}
					return;
				}
				if (d.fileAdd !== void 0 && c) return this.pickFiles(c);
				if (d.fileUnlink && c) {
					await this.act("card/files-remove", {
						id: c.id,
						path: d.fileUnlink
					}, "已解除关联「" + folderName(d.fileUnlink) + "」，文件本身没动");
					return;
				}
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
				if (t.id === "dpmNoteIn") {
					const c = this.sel ? this.card(this.sel) : void 0;
					if (!c) return;
					this.noteEdit = {
						card: c.id,
						draft: t.value
					};
					this.syncNoteBar(c, t.value);
					return;
				}
				if (this.wl && t.closest("#dpmDlgWl")) {
					const w = this.wl;
					const d = t.dataset;
					if (d.wtext !== void 0) w.rows[Number(d.wtext)].text = t.value;
					if (d.wtnew !== void 0) w.rows[Number(d.wtnew)].tdraft = t.value;
					if (d.wurl !== void 0) {
						const r = w.rows[Number(d.wurl)];
						r.url = t.value;
						if (r.err) {
							r.err = "";
							t.classList.remove("bad");
							t.removeAttribute("aria-invalid");
							t.parentElement?.querySelector(".wl-err")?.remove();
						}
						this.wlOkText();
					}
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
				if (t.dataset.wtype !== void 0 && this.wl) {
					const i = Number(t.dataset.wtype);
					const r = this.wl.rows[i];
					if (t.value === "__new") {
						r.tnew = true;
						r.tdraft = "";
						this.wlRender();
						this.root.querySelector("#dpmWtn" + i)?.focus();
						return;
					}
					r.type = t.value;
					return;
				}
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
				if (f.dataset.addfile !== void 0) {
					e.preventDefault();
					const c = this.sel ? this.card(this.sel) : void 0;
					const v = this.$("#dpmFileIn")?.value.trim() ?? "";
					if (!c || !v) return;
					if (!v.startsWith("/") && !v.startsWith("~/")) {
						this.host.toast("请输入绝对路径：" + v, "err");
						return;
					}
					if (await this.act("card/files-add", {
						id: c.id,
						paths: [v]
					}, "已添加相关文件")) this.root.querySelector("#dpmFileIn")?.focus();
					return;
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
				if (this.gd && e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					this.gdStop(false);
					return;
				}
				if (this.wd && e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					this.wdStop(false);
					return;
				}
				const wh = t.closest("[data-wdrag]");
				if (wh && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
					e.preventDefault();
					const c = this.sel ? this.card(this.sel) : void 0;
					const i = Number(wh.dataset.wdrag);
					if (c) await this.wlMove(c, i, e.key === "ArrowUp" ? i - 1 : i + 1);
					return;
				}
				if (this.wl && t.closest("#dpmDlgWl")) {
					if (t.dataset.wtnew !== void 0) {
						const k = Number(t.dataset.wtnew);
						if (e.key === "Enter") {
							e.preventDefault();
							await this.wlAddType(k);
						}
						if (e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							this.wl.rows[k].tnew = false;
							this.wlRender();
							this.root.querySelector("#dpmWt" + k)?.focus();
						}
						return;
					}
					if (e.key === "Enter" && t.tagName === "INPUT" && !e.isComposing) {
						e.preventDefault();
						await this.wlSave();
					}
					return;
				}
				const gh = t.closest("[data-gdrag]");
				if (gh && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
					e.preventDefault();
					const gs = this.groups;
					const i = gs.findIndex((g) => g.id === gh.dataset.gdrag);
					if (e.key === "ArrowUp" && i > 0) await this.moveGroup(gs[i].id, gs[i - 1].id);
					else if (e.key === "ArrowDown" && i >= 0 && i < gs.length - 1) await this.moveGroup(gs[i].id, gs[i + 2]?.id ?? null);
					return;
				}
				const el = t.closest("[data-card]");
				if (el && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
					e.preventDefault();
					const c = this.card(el.dataset.card);
					if (!c || c.archivedAt) return;
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
			async toggleGroup(id) {
				const g = this.grp(id);
				if (!g) return;
				if (await this.act("group/update", {
					id,
					collapsed: !g.collapsed
				})) this.root.querySelector("[data-toggle=\"" + CSS.escape(id) + "\"]")?.focus({ preventScroll: true });
			}
			gd = null;
			gdMarks() {
				this.root.querySelectorAll(".gins-before, .gins-after").forEach((n) => n.classList.remove("gins-before", "gins-after"));
			}
			gdDown(e) {
				const h = e.target.closest?.("[data-gdrag]");
				if (!h || e.button !== 0) return;
				e.preventDefault();
				h.setPointerCapture(e.pointerId);
				this.gd = {
					id: h.dataset.gdrag,
					y0: e.clientY,
					on: false,
					before: void 0
				};
			}
			gdMove(e) {
				const gd = this.gd;
				if (!gd) return;
				if (!gd.on) {
					if (Math.abs(e.clientY - gd.y0) < 4) return;
					gd.on = true;
					this.root.classList.add("gdragging");
					this.root.querySelector("[data-lane=\"" + CSS.escape(gd.id) + "\"]")?.classList.add("lifting");
				}
				const w = this.root.querySelector(".board-wrap");
				const wr = w.getBoundingClientRect();
				if (e.clientY < wr.top + 48) w.scrollTop -= 14;
				else if (e.clientY > wr.bottom - 48) w.scrollTop += 14;
				const lanes = Array.from(this.root.querySelectorAll("[data-lane]")).filter((l) => l.dataset.lane !== gd.id);
				let before = null;
				for (const l of lanes) {
					const r = l.getBoundingClientRect();
					if (e.clientY < r.top + Math.min(r.height / 2, 40)) {
						before = l;
						break;
					}
				}
				this.gdMarks();
				if (before) before.classList.add("gins-before");
				else lanes[lanes.length - 1]?.classList.add("gins-after");
				gd.before = before ? before.dataset.lane : null;
			}
			gdStop(commit) {
				const gd = this.gd;
				if (!gd) return;
				this.gd = null;
				this.gdMarks();
				this.root.classList.remove("gdragging");
				this.root.querySelectorAll(".lane.lifting").forEach((n) => n.classList.remove("lifting"));
				if (commit && gd.on && gd.before !== void 0) this.moveGroup(gd.id, gd.before);
			}
			/** 调整卡片组顺序：顺序没变不发请求；成功后其余组平滑让位，落位的组闪一下描边，焦点回到它的手柄。 */
			async moveGroup(id, beforeId) {
				const ids = this.groups.map((g) => g.id);
				const rest = ids.filter((x) => x !== id);
				rest.splice(beforeId ? rest.indexOf(beforeId) : rest.length, 0, id);
				if (rest.join() === ids.join()) return;
				const tops = /* @__PURE__ */ new Map();
				this.root.querySelectorAll("[data-lane]").forEach((el) => tops.set(el.dataset.lane, el.getBoundingClientRect().top));
				if (!await this.act("group/move", {
					id,
					beforeId
				}, "已调整卡片组顺序")) return;
				this.root.querySelectorAll("[data-lane]").forEach((el) => {
					const t0 = tops.get(el.dataset.lane);
					if (t0 === void 0) return;
					const dy = t0 - el.getBoundingClientRect().top;
					if (Math.abs(dy) > 2) {
						el.style.setProperty("--dy", dy + "px");
						el.classList.add("moved");
						setTimeout(() => el.classList.remove("moved"), 380);
					}
				});
				const el = this.root.querySelector("[data-lane=\"" + CSS.escape(id) + "\"]");
				if (el) {
					el.classList.add("landed");
					setTimeout(() => el.classList.remove("landed"), 720);
				}
				this.root.querySelector("[data-gdrag=\"" + CSS.escape(id) + "\"]")?.focus({ preventScroll: true });
			}
			onDragStart(e) {
				const c = e.target.closest?.("[data-card]");
				if (!c) return;
				this.dragId = c.dataset.card;
				this.root.classList.add("carddrag");
				setTimeout(() => c.classList.add("dragging"), 0);
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", this.dragId);
				}
			}
			clearMarks() {
				this.root.querySelectorAll(".cell.over, .atray.over, .ins-before, .ins-after").forEach((n) => n.classList.remove("over", "ins-before", "ins-after"));
			}
			clearDrag() {
				this.root.classList.remove("carddrag");
				this.clearMarks();
				this.root.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
				this.dragId = null;
				this.dropAt = null;
			}
			onDragOver(e) {
				const tr = this.dragId ? e.target.closest?.(".atray") : null;
				if (tr) {
					if (tr.dataset.trayG !== this.card(this.dragId)?.g) return;
					e.preventDefault();
					this.clearMarks();
					tr.classList.add("over");
					this.dropAt = {
						g: tr.dataset.trayG,
						col: "",
						before: null,
						tray: true
					};
					return;
				}
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
				if (at.tray) {
					await this.archiveCard(c.id);
					return;
				}
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
				if (id === "dpmDlgSArc") {
					const a = this.sa;
					this.sa = null;
					if (ok && a) await this.stopAndArchive(a.id, a.title);
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
				if (id === "dpmDlgWl") this.wl = null;
			}
			/** 批量添加：在「完整链接」里粘贴多行 → 自动拆成多条（沿用当前行的类型）。 */
			onPaste(e) {
				const t = e.target;
				const w = this.wl;
				if (!w || w.mode !== "add" || t.dataset?.wurl === void 0) return;
				const lines = (e.clipboardData?.getData("text") ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
				if (lines.length < 2) return;
				e.preventDefault();
				const i = Number(t.dataset.wurl);
				const type = w.rows[i].type;
				w.rows[i].url = lines[0];
				w.rows.splice(i + 1, 0, ...lines.slice(1).map((u) => ({
					...this.blankRow(type),
					url: u
				})));
				this.wlRender();
				this.host.toast("已拆成 " + lines.length + " 条，显示文字不填就用网址");
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
				if (this.chipSignature() !== this.chipSig && !this.gd && !this.composing) this.render();
				else if (this.sel && !this.$("#dpmDlgSess").open) this.renderDetail();
				if (this.ls) this.renderLinkSess();
			}
			sessIndex() {
				const m = /* @__PURE__ */ new Map();
				for (const s of this.host.allSessions()) m.set(s.id, s);
				return m;
			}
			linkedHtml(c, ro = false) {
				const refs = (this.snap?.board.sessions ?? []).filter((s) => s.cardId === c.id);
				if (!refs.length) return "<p class=\"meta\">" + (ro ? "没有会话。" : "还没有会话。可以「以此卡片新建会话」，或关联已有会话。") + "</p>";
				const idx = this.sessIndex();
				const canRestore = this.snap?.caps?.unarchive !== false;
				return sortLinked(refs, idx).map((r) => {
					const v = idx.get(r.sessionId);
					const title = v?.title ?? r.title ?? "会话 " + r.sessionId.slice(0, 8);
					const unl = ro ? "" : "<button type=\"button\" class=\"ib sm unl tipbtn\" data-unbind=\"" + esc(r.sessionId) + "\" aria-label=\"解除关联 " + esc(title) + "\">" + ic("unlink") + "<span class=\"tip\" aria-hidden=\"true\">解除关联</span></button>";
					if (!v) return "<div class=\"lsess gone\"><div class=\"l1\"><span class=\"lname\">会话已删除</span>" + unl + "</div><div class=\"l2\"><span class=\"sub2\">原名「" + esc(title) + "」</span></div></div>";
					const name = v.archived ? "<span class=\"lname\" title=\"已归档的会话不能打开，先「恢复活跃」\">" + esc(title) + "</span>" : "<button type=\"button\" class=\"lname\" data-open-sess=\"" + esc(v.id) + "\" title=\"打开会话：" + esc(title) + "\">" + esc(title) + "</button>";
					const sarc = ro || v.archived ? "" : "<button type=\"button\" class=\"ib sm sarc tipbtn\" data-archive-sess=\"" + esc(v.id) + "\" aria-label=\"归档会话 " + esc(title) + "\">" + ic("archive") + "<span class=\"tip\" aria-hidden=\"true\">归档会话</span></button>";
					const restore = v.archived && !ro ? "<button type=\"button\" class=\"btn ghost xs\" data-restore=\"" + esc(v.id) + "\"" + (canRestore && !this.restoring.has(v.id) ? "" : " disabled") + " title=\"" + (canRestore ? "恢复到工作区原来的位置" : "当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）") + "\">" + ic("restore") + (this.restoring.has(v.id) ? "恢复中…" : "恢复活跃") + "</button>" : "";
					return "<div class=\"lsess" + (v.archived ? " archived" : "") + "\"><div class=\"l1\">" + name + "<span class=\"acts\">" + sarc + unl + "</span></div><div class=\"l2\">" + (v.archived ? "<span class=\"chip arch\">已归档</span>" : "<span class=\"chip live\">活跃</span>") + "<span class=\"sub2\">" + esc(v.ws) + " · " + esc(ago(v.updatedAt)) + "</span>" + restore + "</div></div>";
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
<dialog class="dpm-dialog" id="dpmDlgSArc" aria-labelledby="dpmSaT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmSaT">停止并归档此会话？</h2><p id="dpmSaP"></p><ul class="cf-list" id="dpmSaL" aria-label="将被停止的工作"></ul></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary danger-fill" type="submit" value="ok">停止并归档</button></div>
</form></dialog>
<dialog class="dpm-dialog" id="dpmDlgLink" aria-labelledby="dpmLkT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmLkT">关联落盘项目</h2><p id="dpmLkP"></p></div>
  <div class="dlg-b"><label class="sr-only" for="dpmLkQ">搜索落盘项目</label><input class="fld" id="dpmLkQ" placeholder="搜索 slug 或状态" autocomplete="off"><div class="pk-list" id="dpmLkList"></div></div>
  <div class="dlg-f"><span class="meta" id="dpmLkCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="submit" value="ok">保存关联</button></div>
</form></dialog>
<dialog class="dpm-dialog wide" id="dpmDlgWl" aria-labelledby="dpmWlT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmWlT">添加相关链接</h2><p id="dpmWlP"></p></div>
  <div class="dlg-b"><div class="wl-rows" id="dpmWlRows"></div><button type="button" class="btn ghost sm wl-add" id="dpmWlMore" data-wl-more>%PLUS%再加一条</button></div>
  <div class="dlg-f"><span class="meta" id="dpmWlCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" type="button" id="dpmWlOk">保存</button></div>
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
		* 侧栏「项目区」与卡片组子工作区行的 DOM 增强（官方未开放行内插槽）：
		*  - 「+」接管：捕获阶段拦截，先选卡片再建会话（「项目区」行列全部卡片，卡片组行只列本组卡片）；
		*  - 0.11 活跃会话数 + 层级：按行 id 生成一张样式表（数字用 ::after 画，层级用缩进 + 引导线），不改宿主节点；
		*  - 0.11 reveal：从看板进入会话时，会话所在的卡片组（及「项目区」）收起着就替用户点开。
		* 依据：dsh-client-ui-workspace 行 [data-row-key="workspace:<工作区 id>"]（role=treeitem，aria-expanded），
		* 整组包在 [class*="groupSection"]（行内 style 带 --dsh-workspace-indent），会话行 [data-row-key="session:<id>"]。
		* 失效时（DSH 改版找不到行）：「+」照常新建会话、数字与层级不出现、不自动展开——功能不丢。
		*/
		const ROW = "[data-row-key^=\"workspace:\"]";
		const SEC = "[class*=\"groupSection\"]";
		const wsRow = (id) => "[data-row-key=\"workspace:" + CSS.escape(id) + "\"]";
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		/**
		* 卡片组行的数字 + 层级样式。counts：卡片组子工作区 id → 活跃会话数；bump：本次数字变了的（轻跳一下）。
		* 数字放在标题和悬停按钮之间；会话行整行缩进到引导线右侧（边框、填充、选中底色一起缩进）。
		*/
		function rowCss(hub, counts, bump) {
			const ids = Object.keys(counts);
			if (!ids.length) return "";
			const rows = ids.map(wsRow);
			const sec = rows.map((r) => SEC + ":has(> * > " + r + ")");
			const any = (list, tail) => list.map((x) => x + tail).join(",\n");
			let css = any(rows, "::after") + " { order: 1; flex: none; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--dpm-cnt-bg); color: var(--dpm-cnt-ink); font-size: 12px; font-weight: 700; line-height: 20px; text-align: center; font-variant-numeric: tabular-nums; }\n" + any(rows, " > [class*=\"rowActions\"]") + " { order: 2; }\n" + any(rows, "[aria-expanded=\"true\"] [class*=\"_title\"]") + " { font-weight: 600; }\n" + any(sec, " > * > [data-row-key^=\"session:\"]") + " { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); padding-inline-start: 8px; }\n" + any(sec, " > *:has(> [data-row-key^=\"session:\"])") + " { background: linear-gradient(var(--dpm-guide), var(--dpm-guide)) no-repeat calc(15.5px + var(--dsh-workspace-indent, 0px)) 0 / 1px 100%; }\n" + any(sec, " > [class*=\"sessionOverflow\"]") + " { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); width: calc(100% - 24px - var(--dsh-workspace-indent, 0px)); padding-inline-start: 30px; }\n";
			for (const id of ids) {
				const n = counts[id];
				css += wsRow(id) + "::after { content: \"" + n + "\" / \"" + (n ? n + " 个活跃会话" : "没有活跃会话") + "\";" + (n ? "" : " background: transparent; color: var(--dsw-alias-label-secondary, #61666b); font-weight: 600; opacity: .7;") + (bump.has(id) ? " animation: dpm-cnt-bump 420ms cubic-bezier(.2, .8, .2, 1);" : "") + " }\n";
			}
			if (hub) css += SEC + ":has(> * > " + wsRow(hub) + "):has(> [role=\"group\"]) > * > [data-row-key^=\"session:\"] { margin-inline-start: 12px; padding-inline-start: 8px; }\n";
			return css;
		}
		var SidebarBridge = class {
			hooks;
			onCapture = (e) => {
				const b = e.target?.closest?.("button");
				if (!b || !/新建会话|New session/i.test(b.getAttribute("aria-label") ?? "")) return;
				const key = b.closest(ROW)?.dataset.rowKey?.slice(10);
				if (!key) return;
				const r = this.hooks.rows();
				const groupId = r.groups[key];
				if (key !== r.hub && !groupId) return;
				e.stopPropagation();
				e.preventDefault();
				this.hooks.pickCard(b, groupId);
			};
			style = null;
			last = {};
			bumpTimer = 0;
			constructor(hooks) {
				this.hooks = hooks;
			}
			start() {
				document.addEventListener("click", this.onCapture, true);
				this.style = document.createElement("style");
				this.style.dataset.plugin = "dsh-project-manager:rows";
				document.head.append(this.style);
			}
			stop() {
				document.removeEventListener("click", this.onCapture, true);
				clearTimeout(this.bumpTimer);
				this.style?.remove();
				this.style = null;
			}
			/** 重画数字与层级。counts：卡片组子工作区 id → 活跃会话数。 */
			paint(hub, counts) {
				if (!this.style) return;
				const bump = new Set(Object.keys(counts).filter((k) => this.last[k] !== void 0 && this.last[k] !== counts[k]));
				this.last = { ...counts };
				this.style.textContent = rowCss(hub, counts, bump);
				if (bump.size) {
					clearTimeout(this.bumpTimer);
					this.bumpTimer = window.setTimeout(() => {
						if (this.style) this.style.textContent = rowCss(hub, this.last, /* @__PURE__ */ new Set());
					}, 480);
				}
			}
			/**
			* 让 wsId 工作区里的 sessionId 在侧栏露出来：卡片组行收起着就点开；卡片组行不在（嵌套在收起的「项目区」下）就先点开「项目区」。
			* 只点 aria-expanded="false" 的行（点之前同步复查，不会把宿主刚自动展开的行又点回去）；侧栏收成图标栏时找不到行，安静结束。
			*/
			async reveal(sessionId, wsId, hub) {
				const open = (k) => {
					const r = document.querySelector(wsRow(k));
					if (!r) return false;
					if (r.getAttribute("aria-expanded") === "false") r.click();
					return true;
				};
				for (let i = 0; i < 20; i++) {
					if (open(wsId)) break;
					if (hub && hub !== wsId) open(hub);
					await wait(100);
				}
				for (let i = 0; i < 20; i++) {
					const s = document.querySelector("[data-row-key=\"session:" + CSS.escape(sessionId) + "\"]");
					if (s) {
						s.scrollIntoView({ block: "nearest" });
						return;
					}
					await wait(100);
				}
			}
		};
		//#endregion
		//#region src/client/style.gen.ts
		const CSS$1 = ".dpm, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts {\n  --pm-select: rgba(15, 17, 21, .06);\n  --pm-brand: #2f5fcc; --pm-brand-ink: #ffffff; --pm-brand-soft: #eaf0fd; --pm-brand-soft-2: #d9e4fb; --pm-brand-line: #c3d3f7;\n  --pm-ok: #146c3f; --pm-ok-soft: #e6faed; --pm-warn: #94480a; --pm-warn-soft: #fff3e2; --pm-warn-line: #f2c38c;\n  --pm-card: var(--dsw-alias-bg-layer-1, #ffffff); --pm-lane: #f7f8fa;\n  --pm-shadow: 0 1px 2px rgba(15, 17, 21, .06); --pm-shadow-2: 0 8px 28px rgba(15, 17, 21, .12);\n  --ease: cubic-bezier(.2, .8, .2, 1);\n}\nbody[data-ds-dark-theme] :is(.dpm, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts) {\n  --pm-select: rgba(255, 255, 255, .08);\n  --pm-brand: #6c97ff; --pm-brand-ink: #0b1020; --pm-brand-soft: #1d2a4a; --pm-brand-soft-2: #26365e; --pm-brand-line: #35508f;\n  --pm-ok: #56cc86; --pm-ok-soft: #1f3a29; --pm-warn: #f2a650; --pm-warn-soft: #33240f; --pm-warn-line: #6b4a1f;\n  --pm-card: var(--dsw-alias-bg-layer-1, #232324); --pm-lane: #1c1c1e;\n  --pm-shadow: 0 1px 2px rgba(0, 0, 0, .4); --pm-shadow-2: 0 12px 32px rgba(0, 0, 0, .5);\n}\n.dpm { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; font-size: 14px; line-height: 1.5; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }\n.dpm-pop, .dpm-dock, .dpm *, .dpm-pop *, .dpm-dock *, .dpm-dialog * { box-sizing: border-box; }\n.dpm button, .dpm input, .dpm select, .dpm textarea, .dpm-dialog button, .dpm-dialog input, .dpm-dialog select, .dpm-dialog textarea, .dpm-pop input { font: inherit; color: inherit; }\n.dpm svg.i, .dpm-pop svg.i, .dpm-dock svg.i, .dpm-dialog svg.i, .dpm-toasts svg.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n.dpm :focus-visible, .dpm-dialog :focus-visible { outline: 2px solid var(--pm-brand); outline-offset: 2px; border-radius: 8px; }\n.dpm .sr-only, .dpm-dialog .sr-only, .dpm-pop .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }\n.dpm .grow, .dpm-pop .grow, .dpm-dock .grow, .dpm-dialog .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .meta, .dpm-dialog .meta { font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm .mono, .dpm-dialog .mono { font-family: \"SF Mono\", Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; }\n.dpm-err { margin: 12px 24px 0; padding: 8px 12px; border: 1px solid var(--pm-warn-line); border-radius: 10px; background: var(--pm-warn-soft); color: var(--pm-warn); font-size: 13px; }\n\n/* ── 插件：选择项目浮层 ── */\n.dpm-pop { position: fixed; z-index: 30; width: 300px; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); box-shadow: var(--pm-shadow-2); animation: popin 180ms var(--ease); }\n@keyframes popin { from { opacity: 0; transform: translateY(-4px) scale(.98); } }\n/* 选卡片浮层：实底（显式回退色，宿主 token 缺失也不会透明）；每行两层信息；悬停与键盘共用高亮 */\n.dpm-pop { --pm-pop-bg: var(--dsw-alias-bg-layer-1, #ffffff); --pm-pop-sub: var(--dsw-alias-bg-module-platform, #f5f6f7); width: 340px; padding: 0; overflow: hidden; background: var(--pm-pop-bg); background-color: var(--pm-pop-bg); color: var(--dsw-alias-label-primary, #0f1115); transform-origin: top left; }\nbody[data-ds-dark-theme] .dpm-pop { --pm-pop-bg: var(--dsw-alias-bg-layer-1, #232324); --pm-pop-sub: var(--dsw-alias-bg-module-platform, #353638); color: var(--dsw-alias-label-primary, #f9fafb); }\n.dpm-pop .ph { padding: 12px 14px 8px; }\n.dpm-pop h3 { margin: 0; font-size: 14px; font-weight: 650; color: var(--dsw-alias-label-primary); }\n.dpm-pop .ph p { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .qw { position: relative; margin: 0 12px 8px; }\n.dpm-pop .qw svg.i { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--dsw-alias-label-secondary); pointer-events: none; }\n.dpm-pop input { width: 100%; height: 36px; margin: 0; padding: 0 12px 0 32px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--pm-pop-sub); outline: 0; transition: border-color 120ms var(--ease), box-shadow 120ms var(--ease); }\n.dpm-pop input:focus { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm-pop ul { max-height: 320px; overflow: auto; margin: 0; padding: 0 6px 6px; list-style: none; scroll-padding: 32px 0 4px; }\n.dpm-pop .grp { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; padding: 8px 8px 4px; background: var(--pm-pop-bg); font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .grp .n { margin-left: auto; font-weight: 500; }\n.dpm-pop .empty { padding: 28px 12px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .opt { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 8px 30px 8px 12px; border-radius: 8px; cursor: pointer; transition: background 120ms var(--ease); }\n.dpm-pop .opt .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }\n.dpm-pop .opt .nm mark { background: transparent; color: var(--pm-brand); font-weight: 700; }\n.dpm-pop .opt .mt { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .opt .stg { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--pm-pop-sub); color: var(--dsw-alias-label-primary); }\n.dpm-pop .opt .mm { display: inline-flex; align-items: center; gap: 3px; color: var(--pm-brand); }\n.dpm-pop .opt .mm.no { color: var(--pm-warn); }\n.dpm-pop .opt .mm svg.i, .dpm-pop .opt .go svg.i { width: 13px; height: 13px; }\n.dpm-pop .opt .go { position: absolute; right: 10px; top: 50%; display: grid; color: var(--pm-brand); opacity: 0; transform: translate(-4px, -50%); transition: opacity 120ms var(--ease), transform 120ms var(--ease); }\n.dpm-pop .opt:hover { background: var(--pm-select); }\n.dpm-pop .opt[aria-selected=\"true\"] { background: var(--pm-brand-soft); }\n.dpm-pop .opt[aria-selected=\"true\"] .nm { color: var(--pm-brand); }\n.dpm-pop .opt[aria-selected=\"true\"]::before { content: \"\"; position: absolute; left: 3px; top: 10px; bottom: 10px; width: 3px; border-radius: 3px; background: var(--pm-brand); }\n.dpm-pop .opt[aria-selected=\"true\"] .go { opacity: 1; transform: translate(0, -50%); }\n.dpm-pop .hint { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; padding: 8px 14px; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--pm-pop-sub); font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .hint span { display: inline-flex; align-items: center; gap: 4px; }\n.dpm-pop kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border: 1px solid var(--dsw-alias-border-l2); border-bottom-width: 2px; border-radius: 4px; background: var(--pm-pop-bg); font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-primary); }\n/* 「新建会话」弹窗 */\n.dpm-dialog .ns-sug { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 8px 12px; border: 1px solid var(--pm-warn-line); border-radius: 10px; background: var(--pm-warn-soft); font-size: 13px; }\n.dpm-dialog .ns-sug .grow { white-space: normal; }\n.dpm-dialog .ns-sec { display: flex; align-items: center; margin: 16px 0 8px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ns-row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; transition: background 120ms var(--ease), border-color 120ms var(--ease), box-shadow 120ms var(--ease); }\n.dpm-dialog .ns-row:hover { background: var(--pm-select); }\n.dpm-dialog .ns-row:has(input:checked) { border-color: var(--pm-brand); background: var(--pm-brand-soft); box-shadow: inset 0 0 0 1px var(--pm-brand); }\n.dpm-dialog .ns-row:has(input:focus-visible) { outline: 2px solid var(--pm-brand); outline-offset: 2px; }\n.dpm-dialog .ns-row input { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--pm-brand); }\n.dpm-dialog .ns-row .txt { flex: 1; min-width: 0; }\n.dpm-dialog .ns-row .nm { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; }\n.dpm-dialog .ns-row .sub { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ns-row .sub .chip { height: 20px; }\n.dpm-dialog .ns-row .ni { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: var(--pm-brand-soft); color: var(--pm-brand); }\n.dpm-dialog .ns-row:has(input:checked) .ni { background: var(--pm-brand); color: var(--pm-brand-ink); }\n.dpm-dialog .ns-row.dis { cursor: default; }\n.dpm-dialog .ns-row.dis:hover { background: transparent; }\n.dpm-dialog .ns-row.dis .nm, .dpm-dialog .ns-row.dis .sub > span:not(.chip) { color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ns-row.fresh { animation: nsfresh 700ms var(--ease); }\n@keyframes nsfresh { 0% { background: var(--pm-brand-soft); } 100% { background: transparent; } }\n.dpm-dialog .ns-empty { padding: 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; font-size: 13px; color: var(--dsw-alias-label-secondary); text-align: center; }\n.dpm-dialog .btn.xs { flex: none; min-height: 28px; padding: 0 8px; gap: 4px; border-radius: 8px; font-size: 13px; }\n.dpm-dialog .btn.xs svg.i { width: 14px; height: 14px; }\n.dpm-dock.nolink { border-color: var(--pm-warn-line); background: var(--pm-warn-soft); }\n.dpm-dock.nolink .dock-h { color: var(--pm-warn); cursor: default; }\n.dpm-dock.nolink .dock-h .grow { white-space: normal; }\n.dpm-dock .btn.xs { display: inline-flex; align-items: center; gap: 4px; flex: none; min-height: 26px; padding: 0 8px; border: 1px solid var(--pm-warn-line); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }\n.dpm-dock .btn.xs:hover { background: var(--pm-select); }\n.dpm-dock .btn.xs svg.i { width: 13px; height: 13px; }\n\n/* ── 插件：项目看板面板 ── */\n@keyframes fadein { from { opacity: 0; } }\n:is(.dpm, .dpm-dialog) .pm-top { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid var(--dsw-alias-border-l2); flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .pm-top h1 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.3; }\n:is(.dpm, .dpm-dialog) .pm-top p { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .pm-top .ttl { flex: 1 1 260px; min-width: 0; }\n:is(.dpm, .dpm-dialog) .search { display: flex; align-items: center; gap: 8px; height: 36px; width: 220px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; }\n:is(.dpm, .dpm-dialog) .search input::placeholder { color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-weight: 600; white-space: nowrap; transition: background 160ms var(--ease), transform 120ms var(--ease); }\n:is(.dpm, .dpm-dialog) .btn:hover { background: var(--dsw-alias-button-floating-hover); }\n:is(.dpm, .dpm-dialog) .btn:active { transform: translateY(1px); }\n:is(.dpm, .dpm-dialog) .btn.primary { background: var(--pm-brand); border-color: var(--pm-brand); color: var(--pm-brand-ink); }\n:is(.dpm, .dpm-dialog) .btn.primary:hover { filter: brightness(1.08); }\n:is(.dpm, .dpm-dialog) .btn.ghost { border-color: transparent; background: transparent; }\n:is(.dpm, .dpm-dialog) .btn.ghost:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .btn.lg { width: 100%; min-height: 44px; font-size: 15px; }\n:is(.dpm, .dpm-dialog) .btn:disabled { opacity: .5; cursor: not-allowed; }\n:is(.dpm, .dpm-dialog) .ib { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .ib:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n:is(.dpm, .dpm-dialog) .pm-body { position: relative; flex: 1; min-height: 0; min-width: 0; display: flex; }\n:is(.dpm, .dpm-dialog) .board-wrap { position: relative; flex: 1; min-width: 0; overflow: auto; padding: 16px 24px 24px; }\n:is(.dpm, .dpm-dialog) .lane { min-width: 0; margin-bottom: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--pm-lane); }\n:is(.dpm, .dpm-dialog) .lane-h { display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .lane-h h2 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.4; }\n:is(.dpm, .dpm-dialog) .lane-h .meta { font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .lane-h .sp { flex: 1; }\n:is(.dpm, .dpm-dialog) .lane.collapsed .chev { transform: rotate(-90deg); }\n:is(.dpm, .dpm-dialog) .lane.collapsed .lane-in { display: none; }\n/* 卡片组头部：左侧整块点击展开/收起；右侧手柄拖动排序 */\n.dpm .lane { position: relative; }\n.dpm .lane-hit { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; align-self: stretch; margin: -4px 0 -4px -6px; padding: 4px 8px 4px 6px; border-radius: 8px; cursor: pointer; user-select: none; transition: background 120ms var(--ease); }\n.dpm .lane-hit:hover { background: var(--pm-select); }\n.dpm .lane-hit h2 { display: flex; }\n.dpm .lane-h .tg { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 4px 0 0; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; font-size: 15px; font-weight: 650; text-align: left; cursor: pointer; }\n.dpm .lane-h .tg .chev-b { width: 24px; height: 24px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary); }\n.dpm .lane-hit:hover .tg .chev-b { color: var(--dsw-alias-label-primary); }\n.dpm .lane-h .chev { transition: transform 200ms var(--ease); }\n.dpm .ib.grip { cursor: grab; touch-action: none; }\n.dpm.gdragging, .dpm.gdragging * { cursor: grabbing !important; user-select: none; }\n.dpm .lane.lifting { opacity: .5; }\n.dpm .lane.gins-before::before, .dpm .lane.gins-after::after { content: \"\"; position: absolute; left: 0; right: 0; height: 3px; border-radius: 3px; background: var(--pm-brand); pointer-events: none; }\n.dpm .lane.gins-before::before { top: -8px; }\n.dpm .lane.gins-after::after { bottom: -8px; }\n.dpm .lane.moved { animation: moved 360ms var(--ease); }\n.dpm .lane.landed { animation: lland 700ms var(--ease); }\n@keyframes lland { 0% { box-shadow: 0 0 0 2px var(--pm-brand); } 100% { box-shadow: 0 0 0 2px transparent; } }\n@media (max-width: 720px), (pointer: coarse) { .dpm .lane-h .tg { min-height: 44px; } }\n/* 详情栏原地更新：不重放滑入与各行淡入 */\n.dpm .detail.stay, .dpm .detail.stay * { animation: none !important; }\n:is(.dpm, .dpm-dialog) .lane-in { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 0 12px 12px; overflow-x: auto; }\n:is(.dpm, .dpm-dialog) .shead, .lane-b { display: grid; grid-template-columns: repeat(var(--cols), minmax(212px, 1fr)); gap: 8px; }\n:is(.dpm, .dpm-dialog) .lane-b { align-items: start; }\n:is(.dpm, .dpm-dialog) .colh { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 14px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .colh .nm { white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .colh .n { height: 20px; line-height: 20px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .cell { display: flex; flex-direction: column; gap: 8px; min-height: 96px; padding: 8px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); transition: background 160ms var(--ease), box-shadow 160ms var(--ease); }\n:is(.dpm, .dpm-dialog) .cell.over { background: var(--pm-brand-soft); box-shadow: inset 0 0 0 2px var(--pm-brand); }\n/* 每个阶段底部常驻「添加卡片」（原型 v8） */\n.dpm .addc { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background 140ms var(--ease), color 140ms var(--ease); }\n.dpm .addc:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n.dpm .cell.empty .addc { justify-content: center; min-height: 40px; border: 1px dashed var(--dsw-alias-border-l3); }\n.dpm .cell.over .addc { visibility: hidden; }\n.dpm .addc-f { display: flex; flex-direction: column; gap: 4px; animation: fadein 160ms var(--ease); }\n.dpm .addc-f input { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--pm-brand); border-radius: 8px; background: var(--pm-card); color: inherit; font: inherit; outline: 0; box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm .addc-f .hint { padding: 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n@media (max-width: 720px), (pointer: coarse) { .dpm .addc { min-height: 40px; } }\n:is(.dpm, .dpm-dialog) .card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--pm-card); box-shadow: var(--pm-shadow); text-align: left; transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease), transform 200ms var(--ease), opacity 160ms var(--ease); }\n:is(.dpm, .dpm-dialog) .card:hover { border-color: var(--dsw-alias-border-l3); box-shadow: var(--pm-shadow-2); transform: translateY(-1px); }\n:is(.dpm, .dpm-dialog) .card[aria-pressed=\"true\"] { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .card.dragging { opacity: .45; }\n:is(.dpm, .dpm-dialog) .card.landed { animation: land 420ms var(--ease); }\n@keyframes land { 0% { transform: scale(.96); } 100% { transform: none; } }\n:is(.dpm, .dpm-dialog) .card h3 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.4; word-break: break-word; }\n:is(.dpm, .dpm-dialog) .card p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n:is(.dpm, .dpm-dialog) .foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .prog { flex: 1; min-width: 96px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n:is(.dpm, .dpm-dialog) .bar { flex: 1; height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); overflow: hidden; }\n:is(.dpm, .dpm-dialog) .bar i { display: block; height: 100%; border-radius: 999px; background: var(--pm-brand); transition: width 400ms var(--ease); }\n:is(.dpm, .dpm-dialog) .chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .chip svg.i { width: 12px; height: 12px; }\n:is(.dpm, .dpm-dialog) .chip.warn { background: var(--pm-warn-soft); color: var(--pm-warn); border-color: var(--pm-warn-line); }\n:is(.dpm, .dpm-dialog) .chip.brand { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.plain { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .empty-board { display: grid; place-items: center; gap: 12px; padding: 48px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }\n\n/* ── 插件：详情栏 ── */\n:is(.dpm, .dpm-dialog) .detail { width: 380px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); animation: slidein 240ms var(--ease); }\n@keyframes slidein { from { opacity: 0; transform: translateX(16px); } }\n:is(.dpm, .dpm-dialog) .d-h { display: flex; align-items: flex-start; gap: 8px; padding: 16px 20px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .d-h h2 { margin: 0; font-size: 18px; font-weight: 650; line-height: 1.35; word-break: break-word; }\n:is(.dpm, .dpm-dialog) .d-h .sub { margin-top: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .d-b { flex: 1; overflow: auto; padding: 0 20px 16px; }\n:is(.dpm, .dpm-dialog) .sec { padding: 16px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .sec:last-child { border-bottom: 0; }\n:is(.dpm, .dpm-dialog) .sec h3 { margin: 0 0 8px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .statebox { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }\n:is(.dpm, .dpm-dialog) .statebox .l { margin: 8px 0 0; font-size: 14px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .statebox .nx { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .statebox .nx b { margin-right: 8px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .repo { display: flex; align-items: center; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n:is(.dpm, .dpm-dialog) .repo .txt { flex: 1; min-width: 0; }\n:is(.dpm, .dpm-dialog) .repo .nm { font-size: 14px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .repo .mono { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .steps { display: flex; margin: 4px 0 12px; }\n:is(.dpm, .dpm-dialog) .step { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 48px; padding: 4px 0; border: 0; background: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .step::before { content: \"\"; position: absolute; top: 13px; left: -50%; width: 100%; height: 2px; background: var(--dsw-alias-border-l3); }\n:is(.dpm, .dpm-dialog) .step:first-child::before { display: none; }\n:is(.dpm, .dpm-dialog) .step .nd { position: relative; z-index: 1; width: 20px; height: 20px; display: grid; place-items: center; border: 2px solid var(--dsw-alias-border-l3); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--pm-brand-ink); transition: background 200ms var(--ease), border-color 200ms var(--ease), box-shadow 200ms var(--ease); }\n:is(.dpm, .dpm-dialog) .step .nd svg.i { width: 12px; height: 12px; stroke-width: 3; }\n:is(.dpm, .dpm-dialog) .step.past .nd { background: var(--pm-brand); border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .step.past::before, .step.cur::before { background: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .step.cur { color: var(--dsw-alias-label-primary); font-weight: 650; }\n:is(.dpm, .dpm-dialog) .step.cur .nd { border-color: var(--pm-brand); box-shadow: 0 0 0 4px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .step:hover .nd { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .task { display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 4px 8px; border-radius: 8px; font-size: 14px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .task:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .task input { width: 16px; height: 16px; accent-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .task.done span { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }\n:is(.dpm, .dpm-dialog) .addtask { display: flex; gap: 8px; margin-top: 8px; }\n:is(.dpm, .dpm-dialog) .addtask input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); outline: 0; }\n:is(.dpm, .dpm-dialog) .addtask input:focus { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .psess { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; margin-bottom: 4px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 14px; }\n:is(.dpm, .dpm-dialog) .psess:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .psess .t { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .d-f { display: flex; flex-direction: column; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .d-f .note { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n\n/* ── 插件：记忆关联 ── */\n:is(.dpm, .dpm-dialog) .chip.mem { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.as-btn { cursor: pointer; font-family: inherit; }\n:is(.dpm, .dpm-dialog) .chip.as-btn:hover { background: var(--pm-brand-soft-2); }\n:is(.dpm, .dpm-dialog) .btn.sm { min-height: 28px; padding: 0 8px; font-size: 13px; }\n:is(.dpm, .dpm-dialog) .meta.mb { margin: 0 0 8px; }\n:is(.dpm, .dpm-dialog) .mrow { display: flex; gap: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); animation: fadein 220ms var(--ease); }\n:is(.dpm, .dpm-dialog) .mrow .txt { flex: 1; min-width: 0; }\n:is(.dpm, .dpm-dialog) .mrow .nm { font-size: 14px; font-weight: 650; word-break: break-all; }\n:is(.dpm, .dpm-dialog) .mrow .l { margin: 4px 0 0; font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .mrow .nx { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .mrow .nx b { margin-right: 8px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .mside { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }\n/* 0.11：关联的落盘项目默认只显示标题，一个按钮全部展开 / 收起 */\n.dpm .mlist:not(.open) .mrow { align-items: center; padding: 8px 8px 8px 12px; }\n.dpm .mlist:not(.open) .mrow .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: normal; }\n.dpm .mlist:not(.open) .mrow .more { display: none; }\n.dpm .mlist:not(.open) .mside { flex-direction: row; align-items: center; }\n.dpm .mlist.open .mrow .more { animation: fadein 200ms var(--ease); }\n.dpm .mlist .mrow .more .mono { display: block; margin-top: 2px; }\n.dpm .mem-tg svg.i { width: 14px; height: 14px; transition: transform 180ms var(--ease); }\n.dpm .mem-tg[aria-expanded=\"true\"] svg.i { transform: rotate(180deg); }\n:is(.dpm, .dpm-dialog) .gl-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px 4px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n:is(.dpm, .dpm-dialog) .gl-row .nm { font-weight: 650; }\n:is(.dpm, .dpm-dialog) .pk-list { max-height: 50vh; overflow: auto; }\n:is(.dpm, .dpm-dialog) .pk { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .pk:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .pk input { margin-top: 4px; accent-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .pk.lock { opacity: .7; cursor: default; }\n:is(.dpm, .dpm-dialog) .pk .nm { font-weight: 650; }\n:is(.dpm, .dpm-dialog) .pk-grp { margin: 12px 0 8px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .pk-grp:first-child { margin-top: 0; }\n:is(.dpm, .dpm-dialog) .card.dragging { opacity: .4; }\n:is(.dpm, .dpm-dialog) .cell .card { position: relative; }\n:is(.dpm, .dpm-dialog) .card.ins-before::before, .card.ins-after::after { content: \"\"; position: absolute; left: 4px; right: 4px; height: 3px; border-radius: 999px; background: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .card.ins-before::before { top: -6px; }\n:is(.dpm, .dpm-dialog) .card.ins-after::after { bottom: -6px; }\n:is(.dpm, .dpm-dialog) .card.moved { animation: moved 360ms var(--ease); }\n@keyframes moved { from { transform: translateY(var(--dy, 0)); } }\n\n/* ── 对话框 / toast ── */\n.dpm-dialog { width: min(560px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--pm-shadow-2); }\n.dpm-dialog::backdrop { background: rgba(15, 17, 21, .32); }\n.dpm-dialog[open] { animation: popin 220ms var(--ease); }\n:is(.dpm, .dpm-dialog) .dlg-h { padding: 20px 20px 4px; }\n:is(.dpm, .dpm-dialog) .dlg-h h2 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.4; }\n:is(.dpm, .dpm-dialog) .dlg-h p { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .dlg-b { padding: 12px 20px; max-height: 60vh; overflow: auto; }\n:is(.dpm, .dpm-dialog) .dlg-b label.lbl { display: block; margin: 8px 0 4px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .fld { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); outline: 0; }\n:is(.dpm, .dpm-dialog) textarea.fld { height: auto; padding: 8px 12px; resize: vertical; }\n/* 0.10：下拉框用自绘箭头，距右边 12px，和输入框左内边距对称 */\n:is(.dpm, .dpm-dialog) select.fld { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer; text-overflow: ellipsis; background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\"); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px 16px; }\nbody[data-ds-dark-theme] :is(.dpm, .dpm-dialog) select.fld { background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\"); }\n:is(.dpm, .dpm-dialog) .fld:focus { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .dlg-f { display: flex; align-items: center; gap: 8px; padding: 12px 20px 20px; }\n:is(.dpm, .dpm-dialog) .dlg-f .sp { flex: 1; }\n:is(.dpm, .dpm-dialog) .st-row { display: grid; grid-template-columns: 24px 1fr 32px; gap: 8px; align-items: center; margin-bottom: 8px; }\n:is(.dpm, .dpm-dialog) .st-row .grip { text-align: center; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .st-row label { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .imp { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .imp:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .imp input { margin-top: 4px; accent-color: var(--pm-brand); }\n.dpm-toasts { position: fixed; left: 50%; bottom: 24px; z-index: 50; display: flex; flex-direction: column; gap: 8px; transform: translateX(-50%); pointer-events: none; }\n.dpm-toasts .toast { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 12px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 13px; box-shadow: var(--pm-shadow-2); animation: popin 240ms var(--ease); }\n\n@media (max-width: 1100px) { .dpm .detail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 20; box-shadow: var(--pm-shadow-2); } }\n@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }\n\n.dpm .pm-top, .dpm .pm-body { animation: fadein 220ms var(--ease); }\n.dpm-toasts { position: fixed; left: 50%; bottom: 24px; z-index: 2147483000; display: flex; flex-direction: column; gap: 8px; transform: translateX(-50%); pointer-events: none; }\n.dpm-toasts .toast.err { background: var(--pm-warn); color: #fff; }\n.dpm-pop { position: fixed; z-index: 2147482000; width: 300px; }\n.dpm .pm-top .ttl { flex: 1 1 260px; min-width: 0; }\n.dpm .ib.sm { width: 24px; height: 24px; }\n.dpm .ib.sm svg.i { width: 14px; height: 14px; }\n.dpm .task { justify-content: space-between; }\n.dpm .task label { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; cursor: pointer; }\n.dpm .task .ib.sm { opacity: 0; }\n.dpm .task:hover .ib.sm, .dpm .task .ib.sm:focus-visible { opacity: 1; }\n.dpm .btn.danger, .dpm-dialog .btn.danger { color: var(--pm-warn); }\n.dpm-dialog.wide { width: min(640px, calc(100vw - 32px)); }\n.dpm-dialog .lbl.row { display: flex; align-items: center; gap: 8px; }\n.dpm-dialog .rp-row { display: grid; grid-template-columns: minmax(120px, 1fr) 88px minmax(140px, 1.6fr) 32px; gap: 4px 8px; align-items: center; margin-bottom: 8px; }\n.dpm-dialog .rp-row .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-dialog .rp-err { grid-column: 1 / -1; margin: 0; font-size: 12px; color: #c62828; }\n.dpm-dialog .fld.bad { border-color: #c62828; }\nbody[data-ds-dark-theme] .dpm-dialog .rp-err { color: #ff8a80; }\nbody[data-ds-dark-theme] .dpm-dialog .fld.bad { border-color: #ff8a80; }\n/* 添加挂载仓库（原型 v9） */\n.dpm-dialog .ar-top, .dpm-dialog .ar-manual { display: flex; align-items: center; gap: 8px; }\n.dpm-dialog .ar-manual { margin-top: 8px; }\n.dpm-dialog .ar-top .fld, .dpm-dialog .ar-manual .fld { flex: 1; min-width: 0; }\n.dpm-dialog [hidden] { display: none !important; }\n.dpm-dialog .ar-sec { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ar-sec .meta { font-weight: 400; }\n.dpm-dialog .ar-list { max-height: 28vh; margin-top: 0; }\n.dpm-dialog .pk .txt { flex: 1; min-width: 0; }\n.dpm-dialog .pk .txt .mono { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-dialog .pk > .chip { flex: none; margin-left: auto; align-self: center; }\n/* 本卡片的会话（原型 v10） */\n.dpm .lsess { margin-bottom: 4px; padding: 6px 4px 6px 8px; border-radius: 8px; }\n.dpm .lsess:hover { background: var(--pm-select); }\n.dpm .lsess .l1 { display: flex; align-items: center; gap: 8px; }\n.dpm .lsess .l2 { display: flex; align-items: center; gap: 8px; min-height: 28px; margin-top: 2px; }\n.dpm .lsess .l2 .sub2 { flex: 1; min-width: 0; }\n.dpm .lsess .lname { flex: 1; min-width: 0; display: block; padding: 0; border: 0; background: none; color: inherit; font: inherit; font-size: 14px; font-weight: 600; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }\n.dpm .lsess button.lname:hover { color: var(--pm-brand); text-decoration: underline; }\n.dpm .lsess .sub2 { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .lsess.gone .lname, .dpm .lsess.archived .lname { color: var(--dsw-alias-label-secondary); cursor: default; }\n.dpm .lsess.gone .lname { font-weight: 400; }\n.dpm .lsess .chip, :is(.dpm, .dpm-dialog) .ls-row .chip { flex: none; }\n:is(.dpm, .dpm-dialog) .chip.live { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.arch { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); }\n.dpm .btn.xs { flex: none; min-height: 28px; padding: 0 8px; gap: 4px; border-radius: 8px; font-size: 13px; }\n.dpm .btn.xs svg.i { width: 14px; height: 14px; }\n.dpm .ib.unl { flex: none; }\n.dpm .ib.unl:hover { color: #c62828; background: rgba(198, 40, 40, .08); }\nbody[data-ds-dark-theme] .dpm .ib.unl:hover { color: #ff8a80; background: rgba(255, 138, 128, .12); }\n.dpm .tipbtn { position: relative; }\n.dpm .tipbtn .tip { position: absolute; right: 0; top: calc(100% + 4px); z-index: 5; padding: 4px 8px; border-radius: 6px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 12px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 120ms var(--ease); }\n.dpm .tipbtn:hover .tip, .dpm .tipbtn:focus-visible .tip { opacity: 1; }\n.dpm-dialog.xwide { width: min(760px, calc(100vw - 32px)); }\n.dpm-dialog .ls-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }\n.dpm-dialog .ls-col { min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm-dialog .ls-col h3 { margin: 0 0 8px; padding: 0 4px; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-list { max-height: 30vh; overflow: auto; }\n.dpm-dialog .ls-grp { display: flex; align-items: center; gap: 6px; margin: 12px 4px 4px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-grp:first-child { margin-top: 0; }\n.dpm-dialog .ls-grp svg.i { width: 14px; height: 14px; }\n.dpm-dialog .ls-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px; border-radius: 8px; cursor: pointer; }\n.dpm-dialog .ls-row:hover { background: var(--pm-select); }\n.dpm-dialog .ls-row input { flex: none; accent-color: var(--pm-brand); }\n.dpm-dialog .ls-row .txt { flex: 1; min-width: 0; }\n.dpm-dialog .ls-row .nm { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }\n.dpm-dialog .ls-row .oth { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--pm-warn); }\n.dpm-dialog .ls-row .t { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-row .chip { height: 22px; font-weight: 400; }\n.dpm-dialog .ls-empty { margin: 8px 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog #dpmLsSel .ls-row { margin-bottom: 4px; border: 1px solid var(--pm-brand-line); background: var(--pm-brand-soft); }\n.dpm-dialog .btn.primary.danger-fill { background: #c62828; border-color: #c62828; color: #ffffff; }\n@media (max-width: 720px) { .dpm-dialog .ls-cols { grid-template-columns: 1fr; } }\n.dpm-dialog .ar-empty { margin: 0; padding: 16px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: 10px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .st-row .grip { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .pk-list { margin-top: 12px; }\n@media (prefers-reduced-motion: reduce) { .dpm *, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts * { animation-duration: 1ms !important; transition-duration: 1ms !important; } }\n\n.dpm-dock { box-sizing: border-box; width: calc(100% - var(--dsh-composer-side-clearance, 0px) * 2); max-width: var(--dsh-composer-card-max-width, 100%); margin: 0 auto 8px; border: 1px solid var(--pm-brand-line); border-radius: 12px; background: var(--pm-brand-soft); color: var(--dsw-alias-label-primary); animation: fadein 240ms var(--ease); }\n.dpm-dock .dock-h { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 12px; border: 0; background: transparent; color: var(--pm-brand); font: inherit; font-size: 13px; font-weight: 650; text-align: left; cursor: pointer; }\n.dpm-dock .dock-h .grow { display: flex; align-items: center; gap: 8px; }\n.dpm-dock .chev { display: inline-flex; transition: transform 200ms var(--ease); }\n.dpm-dock.open .chev { transform: rotate(180deg); }\n.dpm-dock ul { margin: 0; padding: 0 12px 10px; list-style: none; display: flex; flex-direction: column; gap: 4px; }\n.dpm-dock li { display: flex; gap: 8px; font-size: 13px; line-height: 1.5; }\n.dpm-dock li b { flex: none; font-weight: 650; }\n.dpm-dock li span { color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n/* design-review 修正 */\n.dpm-dialog .imp .meta, .dpm-dialog .pk .meta { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n.dpm-dialog #dpmImList { max-height: 46vh; overflow: auto; }\n.dpm .lane-b { align-items: stretch; }\n.dpm .btn.danger, .dpm-dialog .btn.danger { color: #c62828; }\nbody[data-ds-dark-theme] :is(.dpm, .dpm-dialog) .btn.danger { color: #ff8a80; }\n.dpm-dialog .dlg-b > .lbl { margin-top: 20px; }\n.dpm-dialog .dlg-b > .lbl:first-child { margin-top: 0; }\n.dpm-dialog #dpmStAdd { margin: 4px 0 8px; }\n\n\n/* ── v0.7：卡片会话标志（有活跃 = 绿，全归档 = 灰；不闪动）── */\n:is(.dpm, .dpm-dialog) .foot:empty { display: none; }\n:is(.dpm, .dpm-dialog) .chip.ok { background: var(--pm-ok-soft); color: var(--pm-ok); }\n.dpm .chip.sess { gap: 5px; }\n.dpm .chip.sess .bub { position: relative; display: grid; }\n.dpm .chip.sess .bub i { position: absolute; right: -2px; top: -2px; width: 6px; height: 6px; border-radius: 999px; box-shadow: 0 0 0 1.5px var(--pm-card); }\n.dpm .chip.sess.on { background: var(--pm-ok-soft); color: var(--pm-ok); border-color: color-mix(in srgb, var(--pm-ok) 28%, transparent); }\n.dpm .chip.sess.on .bub i { background: var(--pm-ok); }\n.dpm .chip.sess.off { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); }\n.dpm .chip.sess.off .bub i { background: var(--dsw-alias-label-secondary); opacity: .55; }\n/* ── v0.7：相关说明 ── */\n.dpm .note-in { display: block; width: 100%; min-height: 128px; max-height: 50vh; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 14px; line-height: 1.6; resize: vertical; outline: 0; field-sizing: content; }\n.dpm .note-in:focus { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); background: var(--dsw-alias-bg-layer-1); }\n.dpm .note-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; }\n.dpm .note-bar .meta { font-variant-numeric: tabular-nums; }\n.dpm .note-view { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }\n.dpm .note-view a { color: var(--pm-brand); text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }\n.dpm .note-view a:hover { text-decoration-thickness: 2px; }\n/* ── 0.10：相关说明超长折叠（不再内部滚动）── */\n.dpm .note-wrap.clamp .note-view { max-height: 172px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 calc(100% - 44px), transparent); mask-image: linear-gradient(#000 calc(100% - 44px), transparent); }\n.dpm .note-more { margin-top: 4px; color: var(--pm-brand); }\n.dpm .note-more[hidden] { display: none; }\n.dpm .note-more svg.i { transition: transform 160ms var(--ease); }\n.dpm .note-more[aria-expanded=\"true\"] svg.i { transform: rotate(180deg); }\n/* ── 0.10：相关链接 ── */\n.dpm .wl-list { display: flex; flex-direction: column; gap: 6px; }\n.dpm .wl { position: relative; display: flex; align-items: center; gap: 4px; min-height: 40px; padding: 4px 4px 4px 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }\n.dpm .wl:hover { border-color: var(--dsw-alias-border-l3); }\n.dpm .wl .wgrip { flex: none; width: 22px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--dsw-alias-label-secondary); opacity: .45; cursor: grab; touch-action: none; }\n.dpm .wl .wgrip svg.i { width: 14px; height: 14px; }\n.dpm .wl:hover .wgrip, .dpm .wl .wgrip:focus-visible { opacity: 1; }\n.dpm .wl .wl-a { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 4px 2px; color: var(--dsw-alias-label-primary); text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px; }\n.dpm .wl .wl-a.ro { padding-left: 8px; }\n.dpm .wl .wl-a svg.i { flex: none; color: var(--dsw-alias-label-secondary); }\n.dpm .wl .wl-a .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .wl .wl-a:hover .t { color: var(--pm-brand); text-decoration: underline; text-underline-offset: 2px; }\n.dpm .wl .chip { flex: none; height: 20px; }\n.dpm .wl .acts { display: flex; gap: 2px; flex: none; opacity: 0; transition: opacity 120ms var(--ease); }\n.dpm .wl:hover .acts, .dpm .wl:focus-within .acts { opacity: 1; }\n@media (hover: none) { .dpm .wl .acts, .dpm .wl .wgrip { opacity: 1; } }\n.dpm .wl .ib.sm { width: 28px; height: 28px; }\n.dpm .wl .ib.del:hover { color: #c62828; background: rgba(198, 40, 40, .08); }\nbody[data-ds-dark-theme] .dpm .wl .ib.del:hover { color: #ff8a80; }\n.dpm .wl.lifting { opacity: .45; }\n.dpm .wl.wins-before::before, .dpm .wl.wins-after::after { content: \"\"; position: absolute; left: 4px; right: 4px; height: 3px; border-radius: 999px; background: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); pointer-events: none; }\n.dpm .wl.wins-before::before { top: -5px; }\n.dpm .wl.wins-after::after { bottom: -5px; }\n.dpm .wl.landed { animation: land 420ms var(--ease); }\n.dpm.wdragging, .dpm.wdragging * { cursor: grabbing !important; user-select: none; }\n.dpm-dialog .wl-rows { display: flex; flex-direction: column; gap: 10px; }\n.dpm-dialog .wl-row { padding: 10px 12px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm-dialog .wl-row-h { display: flex; align-items: center; gap: 8px; min-height: 24px; margin-bottom: 4px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .wl-row-h .ib.sm { width: 28px; height: 28px; }\n.dpm-dialog .wl-grid { display: grid; grid-template-columns: minmax(0, 1fr) 148px; gap: 4px 8px; align-items: end; }\n.dpm-dialog .wl-grid .full { grid-column: 1 / -1; }\n.dpm-dialog .wl-grid .lbl { display: block; margin: 6px 0 4px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .wl-tnew { display: flex; gap: 4px; }\n.dpm-dialog .wl-tnew .fld { min-width: 0; }\n.dpm-dialog .wl-tnew .btn { flex: none; min-height: 36px; padding: 0 10px; }\n.dpm-dialog .wl-err { margin: 4px 0 0; font-size: 12px; color: #c62828; }\nbody[data-ds-dark-theme] .dpm-dialog .wl-err { color: #ff8a80; }\n.dpm-dialog .wl-add { margin-top: 10px; }\n@media (max-width: 720px) { .dpm-dialog .wl-grid { grid-template-columns: 1fr; } }\n/* ── v0.7：相关文件 ── */\n.dpm .frow-f { display: flex; align-items: flex-start; gap: 10px; padding: 8px 6px 8px 10px; margin-bottom: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm .frow-f > svg.i { margin-top: 2px; color: var(--dsw-alias-label-secondary); }\n.dpm .frow-f .txt { flex: 1; min-width: 0; }\n.dpm .frow-f .nm { font-size: 14px; font-weight: 600; word-break: break-all; }\n.dpm .frow-f .mono { display: block; margin-top: 2px; line-height: 1.45; }\n.dpm .frow-f .chip { height: 20px; margin-top: 6px; }\n.dpm .frow-f.gone { border-style: dashed; }\n.dpm .frow-f.gone > svg.i { color: var(--pm-warn); }\n.dpm .frow-f.gone .nm { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }\n\n/* ── 0.8 卡片归档（原型 v19） ── */\n/* 卡片组头部不折行：名称/统计可截断，右侧按钮始终一排，「已归档卡片」紧贴「新会话」 */\n@media (min-width: 721px) {\n  .dpm .lane-h { flex-wrap: nowrap; }\n  .dpm .lane-hit { flex: 1 1 0; flex-wrap: nowrap; overflow: hidden; }\n  .dpm .lane-hit .meta { flex: 0 1000 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }\n  .dpm .lane-hit h2 { flex: 0 1 auto; min-width: 48px; }\n  .dpm .lane-hit h2 .tg { min-width: 0; }\n  .dpm .lane-hit h2 .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n  .dpm .lane-hit .chip { flex: none; }\n  .dpm .lane-h > .btn, .dpm .lane-h > .ib { flex: none; }\n}\n.dpm .card { position: relative; }\n.dpm .card h3 { padding-right: 22px; }\n.dpm .card .carc { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; opacity: 0; transition: opacity 120ms var(--ease), background 120ms var(--ease), color 120ms var(--ease); }\n.dpm .card:hover .carc, .dpm .card:focus-within .carc, .dpm .card .carc:focus-visible { opacity: 1; }\n@media (pointer: coarse) { .dpm .card .carc { opacity: 1; } }\n.dpm .card.leaving { animation: dpmleave 220ms var(--ease) forwards; pointer-events: none; }\n@keyframes dpmleave { to { opacity: 0; transform: scale(.94) translateY(-4px); } }\n.dpm .btn .cnt { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); font-size: 12px; font-weight: 650; line-height: 20px; text-align: center; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n.dpm .lane-h .btn[aria-expanded=\"true\"] { background: var(--pm-brand-soft); color: var(--pm-brand); }\n.dpm .lane-h .btn[aria-expanded=\"true\"] .cnt { background: var(--pm-brand); color: var(--pm-brand-ink); }\n.dpm .atray { margin: 0 12px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; outline: 2px dashed transparent; outline-offset: -2px; animation: dpmtray 160ms var(--ease); transition: outline-color 120ms var(--ease); }\n@keyframes dpmtray { from { opacity: 0; transform: translateY(-4px); } }\n.dpm .lane.collapsed .atray { display: none; }\n.dpm .atray-h { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dpm .atray-l { max-height: 296px; overflow: auto; padding: 6px; }\n.dpm .arow { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 3px 3px 3px 7px; border: 1px solid transparent; border-radius: 8px; cursor: pointer; transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease); }\n.dpm .arow + .arow { margin-top: 2px; }\n.dpm .arow:hover { background: var(--pm-select); }\n/* 选中 = 与活跃卡片选中同一套：蓝色边框 + 浅蓝外圈 */\n.dpm .arow[aria-current=\"true\"] { background: var(--pm-card); border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm .arow[aria-current=\"true\"] .nm { font-weight: 600; }\n.dpm .arow .txt { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 12px; }\n.dpm .arow .nm { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }\n.dpm .arow .sub { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm .arow.leaving { animation: dpmrowout 220ms var(--ease) forwards; }\n@keyframes dpmrowout { to { opacity: 0; transform: translateX(12px); } }\n.dpm .arow.landed { animation: lland 700ms var(--ease); }\n.dpm .ib.rst { flex: none; width: 28px; height: 28px; opacity: 0; }\n.dpm .arow:hover .ib.rst, .dpm .arow:focus-within .ib.rst, .dpm .arow[aria-current=\"true\"] .ib.rst, .dpm .ib.rst:focus-visible { opacity: 1; }\n@media (pointer: coarse) { .dpm .ib.rst { opacity: 1; } }\n/* 列表是滚动容器：提示放到图标左侧同一行，最后一行也不会被裁掉 */\n.dpm .ib.rst .tip { top: 50%; right: calc(100% + 6px); transform: translateY(-50%); }\n.dpm.carddrag .atray { outline-color: var(--dsw-alias-border-l3); }\n.dpm .atray.over { outline: 2px solid var(--pm-brand); }\n.dpm .atray-drop { display: none; align-items: center; justify-content: center; min-height: 40px; margin: 0 0 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm.carddrag .atray-drop { display: flex; }\n.dpm .atray.over .atray-drop { color: var(--pm-brand); }\n.dpm.carddrag .atray-empty { display: none; }\n.dpm .atray-empty { margin: 0; padding: 20px 12px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n/* 已归档详情：标题下一条细状态栏，说明 + 恢复按钮同一行；正文无操作入口 */\n.dpm .arch-bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 20px; border-bottom: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm .arch-bar .txt { flex: 1; min-width: 0; }\n.dpm .arch-bar b { font-weight: 650; color: var(--dsw-alias-label-primary); }\n.dpm .detail.ro .step, .dpm .detail.ro .task { cursor: default; }\n.dpm .detail.ro .step:hover .nd { border-color: var(--dsw-alias-border-l3); }\n.dpm .detail.ro .step.past:hover .nd, .dpm .detail.ro .step.cur:hover .nd { border-color: var(--pm-brand); }\n.dpm .lsess .acts { display: flex; gap: 2px; flex: none; margin-left: auto; }\n.dpm-toasts .toast .ta { pointer-events: auto; margin-left: 8px; padding: 2px 8px; border: 0; border-radius: 6px; background: rgba(255, 255, 255, .16); color: inherit; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }\nbody[data-ds-dark-theme] .dpm-toasts .toast .ta { background: rgba(0, 0, 0, .12); }\n.dpm-dialog .cf-list { margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n\n/* ── 0.9 全局面板「项目看板」主按钮（原型 v15-panel2）──\n   宿主行 = button:has(> * > .dpm-entry)（只认插件自己的图标块，不依赖宿主哈希类名）；规则失效时退化为普通图标行。 */\n@property --dpm-rim { syntax: \"<angle>\"; inherits: false; initial-value: 0deg; }\nbutton:has(.dpm-entry) {\n  --dpm-a: #2f5fcc; --dpm-b: #0a7d9c; --dpm-ink: #1f4fb8; --dpm-side: var(--dsw-specific-sidebar-fill, #f9fafb);\n  --ease: cubic-bezier(.2, .8, .2, 1);\n  position: relative; isolation: isolate; overflow: hidden; min-height: 42px; margin-block: 2px 4px; border-radius: 12px;\n  color: var(--dpm-ink) !important; font-weight: 650;\n  background: linear-gradient(115deg, color-mix(in srgb, var(--dpm-a) 11%, var(--dpm-side)) 0%, color-mix(in srgb, var(--dpm-b) 13%, var(--dpm-side)) 100%) !important;\n  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dpm-a) 26%, transparent), 0 1px 2px rgba(15, 17, 21, .05);\n  transition: transform 220ms var(--ease), box-shadow 260ms var(--ease), color 220ms var(--ease);\n}\nbody[data-ds-dark-theme] button:has(.dpm-entry) { --dpm-ink: #b9ccff; --dpm-side: var(--dsw-specific-sidebar-fill, #1c1c1e); box-shadow: inset 0 0 0 1px color-mix(in srgb, #8fb0ff 30%, transparent); }\n/* 宿主图标槽必须保持 static，光效层/徽标才能以整行为定位基准；标题文字盖在光效层上 */\nbutton:has(.dpm-entry) > :has(.dpm-entry), button:has(.dpm-entry) > :has(.dpm-entry) :has(.dpm-entry) { position: static !important; }\nbutton:has(.dpm-entry) > :not(:has(.dpm-entry)) { position: relative; z-index: 2; }\n/* 图标栏：角标以图标块为基准 */\nbutton:has(.dpm-entry.rail) > :has(.dpm-entry) { position: relative !important; }\nbutton:has(.dpm-entry):hover { transform: translateY(-1px); background: linear-gradient(115deg, color-mix(in srgb, var(--dpm-a) 16%, var(--dpm-side)) 0%, color-mix(in srgb, var(--dpm-b) 19%, var(--dpm-side)) 100%) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dpm-a) 40%, transparent), 0 6px 18px color-mix(in srgb, var(--dpm-a) 22%, transparent); }\nbutton:has(.dpm-entry):active { transform: translateY(0) scale(.975); transition-duration: 90ms; }\nbutton:has(.dpm-entry[data-active=\"true\"]) { color: #ffffff !important; background: linear-gradient(115deg, var(--dpm-a) 0%, var(--dpm-b) 100%) !important; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .22), 0 8px 22px color-mix(in srgb, var(--dpm-a) 38%, transparent); transform: none; }\nbutton:has(.dpm-entry[data-active=\"true\"]):hover { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .3), 0 10px 26px color-mix(in srgb, var(--dpm-b) 42%, transparent); }\nbutton:has(.dpm-entry):focus-visible { outline: 2px solid var(--dpm-a); outline-offset: 2px; }\n/* 图标块（宿主给 16/18px 的槽位，插件块 24px） */\n.dpm-entry { position: static; display: inline-grid; place-items: center; width: 24px; height: 24px; margin: -4px -2px; }\n.dpm-entry .pgw { position: relative; z-index: 2; width: 24px; height: 24px; }\n.dpm-entry .pg { position: relative; width: 24px; height: 24px; display: grid; place-items: center; overflow: hidden; border-radius: 8px; color: #ffffff; background: linear-gradient(135deg, var(--dpm-a), var(--dpm-b)); box-shadow: 0 2px 8px color-mix(in srgb, var(--dpm-a) 35%, transparent), inset 0 0 0 1px rgba(255, 255, 255, .2); transition: background 220ms var(--ease), color 220ms var(--ease), transform 160ms var(--ease); }\n.dpm-entry .pgi { width: 16px; height: 16px; overflow: visible; }\n.dpm-entry .pgi rect { fill: currentColor; stroke: none; transform-box: fill-box; transform-origin: 50% 0; }\n.dpm-entry .pgi .b2 { fill: color-mix(in srgb, currentColor 55%, transparent); }\n.dpm-entry .pgi .drop { opacity: 0; fill: var(--dpm-a); transform-origin: 50% 50%; }\n.dpm-entry[data-active=\"true\"] .pg { background: rgba(255, 255, 255, .95); color: var(--dpm-a); box-shadow: 0 2px 10px rgba(20, 10, 60, .25); }\n.dpm-entry[data-active=\"true\"] .pgi .b2 { fill: color-mix(in srgb, var(--dpm-a) 45%, transparent); }\n.dpm-entry[data-active=\"true\"] .pgi .drop { opacity: 1; }\nbutton:has(.dpm-entry):hover .pgi .b1 { animation: dpm-eq 560ms var(--ease) both; }\nbutton:has(.dpm-entry):hover .pgi .b2 { animation: dpm-eq 560ms 70ms var(--ease) both; }\nbutton:has(.dpm-entry):hover .pgi .b3 { animation: dpm-eq 560ms 140ms var(--ease) both; }\n@keyframes dpm-eq { 0%, 100% { transform: scaleY(1); } 35% { transform: scaleY(.55); } 70% { transform: scaleY(1.12); } }\n/* 光效层：铺满宿主整行 */\n.dpm-entry .hfx { position: absolute; inset: 0; z-index: 1; border-radius: inherit; pointer-events: none; overflow: hidden; }\n.dpm-entry .hfx .rim { position: absolute; inset: 0; border-radius: 12px; padding: 1.5px; background: conic-gradient(from var(--dpm-rim), transparent 0 62%, var(--dpm-a) 76%, #3fd0ea 86%, transparent 96%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0; }\nbutton:has(.dpm-entry):hover .hfx .rim { animation: dpm-rim 1100ms var(--ease) both; }\n@keyframes dpm-rim { 0% { opacity: 0; --dpm-rim: 0deg; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; --dpm-rim: 360deg; } }\n.dpm-entry .hfx .spot { position: absolute; inset: 0; background: radial-gradient(120px circle at var(--dpm-mx, 50%) var(--dpm-my, 50%), rgba(255, 255, 255, .55), transparent 60%); opacity: 0; transition: opacity 200ms var(--ease); }\nbutton:has(.dpm-entry):hover .hfx .spot { opacity: .55; }\nbutton:has(.dpm-entry[data-active=\"true\"]):hover .hfx .spot { opacity: .28; }\n.dpm-entry .hfx .sheen { position: absolute; top: -20%; bottom: -20%; left: 0; width: 38%; background: linear-gradient(100deg, transparent, rgba(255, 255, 255, .55), transparent); transform: translateX(-120%) skewX(-16deg); opacity: 0; }\nbutton:has(.dpm-entry):hover .hfx .sheen { animation: dpm-sheen 900ms 80ms var(--ease) both; }\n.dpm-entry.fx .hfx .sheen { animation: dpm-sheen 900ms 180ms var(--ease) both; }\n@keyframes dpm-sheen { 0% { opacity: 1; transform: translateX(-120%) skewX(-16deg); } 100% { opacity: 1; transform: translateX(380%) skewX(-16deg); } }\n.dpm-entry .hfx .ripple { position: absolute; left: var(--dpm-rx, 50%); top: var(--dpm-ry, 50%); width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: rgba(255, 255, 255, .55); opacity: 0; }\n.dpm-entry.fx .hfx .ripple { animation: dpm-ripple 650ms var(--ease) both; }\n@keyframes dpm-ripple { 0% { opacity: .7; transform: scale(0); } 100% { opacity: 0; transform: scale(22); } }\n.dpm-entry .pgw::before { content: \"\"; position: absolute; inset: -3px; border-radius: 11px; box-shadow: 0 0 0 2px #ffffff; opacity: 0; pointer-events: none; }\n.dpm-entry.fx .pgw::before { animation: dpm-burst 620ms var(--ease) both; }\n.dpm-entry.fx .pgi .drop { animation: dpm-drop 520ms cubic-bezier(.3, 1.6, .5, 1) both; }\n@keyframes dpm-burst { 0% { opacity: .55; transform: scale(.8); } 100% { opacity: 0; transform: scale(1.75); } }\n@keyframes dpm-drop { 0% { opacity: 0; transform: translateY(-15px) scale(.6); } 60% { opacity: 1; } 100% { opacity: 1; transform: none; } }\n/* 徽标：进行中卡片数 */\n.dpm-entry .hbadge { position: absolute; right: 8px; top: 50%; z-index: 2; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; transform: translateY(-50%); background: color-mix(in srgb, var(--dpm-a) 14%, var(--dsw-alias-bg-layer-1, #ffffff)); color: var(--dpm-ink); font-size: 12px; font-weight: 650; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dpm-a) 22%, transparent); }\n.dpm-entry .hbadge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .75; }\n.dpm-entry[data-active=\"true\"] .hbadge { background: rgba(255, 255, 255, .2); color: #ffffff; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .28); }\n.dpm-entry.fx .hbadge { animation: dpm-pop 520ms 260ms cubic-bezier(.3, 1.6, .5, 1) both; }\n@keyframes dpm-pop { 0% { transform: translateY(-50%) scale(.6); } 100% { transform: translateY(-50%) scale(1); } }\n/* 侧栏收成图标栏（宿主给 18px 槽位）：渐变方块 + 红色数字角标 */\nbutton:has(.dpm-entry.rail) { min-height: 0; margin-block: 0; overflow: visible; background: transparent !important; box-shadow: none !important; }\nbutton:has(.dpm-entry.rail):hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 17, 21, .06)) !important; transform: none; }\n.dpm-entry.rail { position: relative; }\n.dpm-entry.rail .hfx { display: none; }\n.dpm-entry.rail .hbadge { right: -9px; top: -9px; z-index: 3; height: 16px; min-width: 16px; padding: 0 4px; justify-content: center; transform: none; font-size: 11px; background: #e5484d; color: #ffffff; box-shadow: 0 0 0 2px var(--dpm-side); }\n.dpm-entry.rail .hbadge i, .dpm-entry.rail .hbadge .hl { display: none; }\n.dpm-entry.rail.fx .hbadge { animation: none; }\n/* 0.11：侧栏卡片组行的活跃会话数与层级引导线（规则按行 id 由 sidebar.ts 生成，这里只放颜色与动画） */\n:root { --dpm-cnt-bg: #eaf0fd; --dpm-cnt-ink: #2f5fcc; --dpm-guide: rgba(15, 17, 21, .14); }\nbody[data-ds-dark-theme] { --dpm-cnt-bg: #1d2a4a; --dpm-cnt-ink: #8fb0ff; --dpm-guide: rgba(255, 255, 255, .18); }\n@keyframes dpm-cnt-bump { 40% { transform: scale(1.25); } }\n@media (prefers-reduced-motion: reduce) {\n  [data-row-key]::after { animation: none !important; }\n  button:has(.dpm-entry), button:has(.dpm-entry):hover { transform: none; }\n  .dpm-entry *, .dpm-entry *::before { animation: none !important; transition: none !important; }\n}\n";
		//#endregion
		//#region src/client/entry.ts
		/**
		* 全局面板「项目看板」主按钮的图标块（原型 v15-panel2）。
		* 行（button）由宿主 dsh-client-ui-sidebar 画，插件经 sidebar.panellist 只给图标组件：
		*  - .dpm-entry 本身是行内的图标块；整行渐变 / 浮起 / 选中态由 style.css 里 button:has(.dpm-entry) 规则给宿主行加（非公开选择器，失效 = 普通图标行）；
		*  - 光效层（流光边框 / 跟随光晕 / 高光 / 波纹）与「N 进行中」徽标从图标块里绝对定位铺满整行（宿主行由同一条 CSS 设为 position:relative）。
		* 动效只在状态变化时播一次（悬停 / 点击 / 进入看板），不循环；prefers-reduced-motion 下全部关闭。
		*/
		/** 进行中 = 未归档、且不在本组第一个也不在最后一个阶段的卡片。 */
		function doingCount(b) {
			const sts = new Map(b.groups.map((g) => [g.id, g.statuses.map((s) => s.id)]));
			return b.cards.filter((c) => {
				if (c.archivedAt) return false;
				const ids = sts.get(c.g) ?? [];
				const i = ids.indexOf(c.col);
				return i > 0 && i < ids.length - 1;
			}).length;
		}
		const GLYPH = "<svg class=\"pgi\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect class=\"b1\" x=\"3.5\" y=\"4\" width=\"4.5\" height=\"15\" rx=\"2.25\"/><rect class=\"b2\" x=\"9.75\" y=\"4\" width=\"4.5\" height=\"10\" rx=\"2.25\"/><rect class=\"b3\" x=\"16\" y=\"4\" width=\"4.5\" height=\"12.5\" rx=\"2.25\"/><rect class=\"drop\" x=\"10.6\" y=\"15.6\" width=\"2.8\" height=\"3.2\" rx=\"1.1\"/></svg>";
		function BoardEntry(p) {
			const ref = (0, react.useRef)(null);
			const was = (0, react.useRef)(p.active);
			(0, react.useEffect)(() => {
				const row = ref.current?.closest("button");
				if (!row) return;
				const move = (e) => {
					const r = row.getBoundingClientRect();
					row.style.setProperty("--dpm-mx", e.clientX - r.left + "px");
					row.style.setProperty("--dpm-my", e.clientY - r.top + "px");
				};
				const down = (e) => {
					const r = row.getBoundingClientRect();
					row.style.setProperty("--dpm-rx", e.clientX - r.left + "px");
					row.style.setProperty("--dpm-ry", e.clientY - r.top + "px");
				};
				row.addEventListener("pointermove", move, { passive: true });
				row.addEventListener("pointerdown", down, { passive: true });
				return () => {
					row.removeEventListener("pointermove", move);
					row.removeEventListener("pointerdown", down);
					for (const k of [
						"--dpm-mx",
						"--dpm-my",
						"--dpm-rx",
						"--dpm-ry"
					]) row.style.removeProperty(k);
				};
			}, []);
			(0, react.useEffect)(() => {
				const el = ref.current;
				if (!el) return;
				if (p.active && !was.current) {
					el.classList.remove("fx");
					el.offsetWidth;
					el.classList.add("fx");
				}
				if (!p.active) el.classList.remove("fx");
				was.current = p.active;
			}, [p.active]);
			return (0, react.createElement)("span", {
				ref,
				className: "dpm-entry" + (p.compact ? " rail" : ""),
				"data-active": String(p.active),
				"aria-hidden": "true"
			}, (0, react.createElement)("span", { className: "hfx" }, (0, react.createElement)("span", { className: "rim" }), (0, react.createElement)("span", { className: "spot" }), (0, react.createElement)("span", { className: "sheen" }), (0, react.createElement)("span", { className: "ripple" })), p.count > 0 ? (0, react.createElement)("span", {
				className: "hbadge",
				title: p.count + " 张卡片进行中"
			}, (0, react.createElement)("i"), String(p.count), (0, react.createElement)("span", { className: "hl" }, " 进行中")) : null, (0, react.createElement)("span", { className: "pgw" }, (0, react.createElement)("span", {
				className: "pg",
				dangerouslySetInnerHTML: { __html: GLYPH }
			})));
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-project-manager client：主区看板面板 + 全局面板「项目看板」主按钮 + 「项目区」/卡片组行「+」接管 + 会话记忆提示 + 选卡片浮层。
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
		/** 用户当前的侧栏分组方式是不是「按工作区树」（读 dsh 工作区浏览器存在本地的视图设置；非公开 → 读不到按否处理）。 */
		function treeMode() {
			try {
				const v = JSON.parse(localStorage.getItem("dsh.workspace.view.v5") ?? "null");
				return (v?.groupBy ?? v?.state?.groupBy) === "workspace-tree";
			} catch {
				return false;
			}
		}
		function apply(ctx) {
			ctx.effect(() => {
				const s = document.createElement("style");
				s.dataset.plugin = "dsh-project-manager";
				s.textContent = CSS$1;
				document.head.append(s);
				return () => s.remove();
			}, "dsh-project-manager: css");
			let toastBox = null;
			const toast = (msg, kind = "ok", action) => {
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
				if (action) {
					const b = document.createElement("button");
					b.type = "button";
					b.className = "ta";
					b.textContent = action.label;
					b.addEventListener("click", () => {
						el.remove();
						action.run();
					});
					el.append(b);
				}
				toastBox.append(el);
				while (toastBox.children.length > 2) toastBox.firstElementChild?.remove();
				setTimeout(() => el.remove(), kind === "err" ? 5e3 : action ? 6e3 : 2400);
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
				closeNs();
				try {
					const { workspaceId, workspaceTitle } = await post("session/prepare", { cardId });
					const sessionId = await ctx.sessions.create({ workspaceId });
					const r = await post("session/bind", {
						sessionId,
						cardId,
						tree: treeMode()
					});
					openAndReveal(sessionId, workspaceId);
					live.refresh();
					toast("已在「" + workspaceTitle + "」新建" + (r.title ? "「" + r.title + "」" : "会话") + (r.permission ? " · 完全权限" : ""));
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
					const cs = b.cards.filter((c) => c.g === g.id && !c.archivedAt).sort((a, c) => g.statuses.findIndex((s) => s.id === a.col) - g.statuses.findIndex((s) => s.id === c.col) || a.order - c.order);
					for (const c of cs) {
						if (pop.q && !(c.t + " " + g.name).toLowerCase().includes(pop.q)) continue;
						const mem = (/* @__PURE__ */ new Set([...g.links, ...c.links])).size;
						out.push({
							id: c.id,
							t: c.t,
							g: g.id,
							gname: g.name,
							st: g.statuses.find((s) => s.id === c.col)?.name ?? "",
							mem,
							sess: b.sessions.filter((s) => s.cardId === c.id).length
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
				const hl = (t) => {
					const q = pop.q;
					const i = q ? t.toLowerCase().indexOf(q) : -1;
					return i < 0 ? esc(t) : esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
				};
				items.forEach((c, k) => {
					if (c.g !== last) {
						html += "<li class=\"grp\" role=\"presentation\">" + esc(c.gname) + "<span class=\"n\">" + items.filter((x) => x.g === c.g).length + "</span></li>";
						last = c.g;
					}
					html += "<li class=\"opt\" role=\"option\" id=\"dpm-opt-" + esc(c.id) + "\" data-pick=\"" + esc(c.id) + "\" data-k=\"" + k + "\" aria-selected=\"" + (k === pop.i) + "\"><span class=\"nm\">" + hl(c.t) + "</span><span class=\"mt\"><span class=\"stg\">" + esc(c.st) + "</span>" + (c.mem ? "<span class=\"mm\">" + ic("mem") + c.mem + " 个记忆</span>" : "<span class=\"mm no\">" + ic("mem") + "未关联记忆</span>") + "<span>" + (c.sess ? c.sess + " 个会话" : "无会话") + "</span></span><span class=\"go\" aria-hidden=\"true\">" + ic("arrow") + "</span></li>";
				});
				const list = pop.el.querySelector("ul");
				list.innerHTML = html || "<li class=\"empty\" role=\"presentation\">" + (pop.q ? "没有匹配「" + esc(pop.q) + "」的卡片" : pop.snap.board.cards.length ? "没有匹配的卡片" : "还没有卡片，先去项目看板添加") + "</li>";
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
				el.innerHTML = "<div class=\"ph\"><h3>新会话属于哪张卡片？</h3><p>选好卡片后，再选新建会话或打开它已关联的会话</p></div><div class=\"qw\">" + ic("search") + "<label class=\"sr-only\" for=\"dpmPopQ\">搜索卡片</label><input id=\"dpmPopQ\" role=\"combobox\" aria-expanded=\"true\" aria-controls=\"dpmPopList\" autocomplete=\"off\" placeholder=\"搜索卡片或卡片组\"></div><ul id=\"dpmPopList\" role=\"listbox\" aria-label=\"卡片\"></ul><p class=\"hint\"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>下一步</span><span><kbd>Esc</kbd>关闭</span></p>";
				document.body.append(el);
				const r = anchor.getBoundingClientRect();
				el.style.left = Math.max(8, Math.min(r.left, innerWidth - 356)) + "px";
				el.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 470)) + "px";
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
							const s = pop.snap;
							closePop();
							openNs(it.id, s);
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
					if (li && pop) {
						const s = pop.snap;
						closePop();
						openNs(li.dataset.pick, s);
					}
				});
				el.addEventListener("mousemove", (e) => {
					const li = e.target.closest(".opt");
					if (!li || !pop) return;
					const k = Number(li.dataset.k);
					if (k === pop.i) return;
					pop.i = k;
					el.querySelectorAll(".opt").forEach((o) => o.setAttribute("aria-selected", String(o === li)));
					q.setAttribute("aria-activedescendant", li.id);
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
			let ns = null;
			const closeNs = () => {
				const d = ns?.dlg;
				ns = null;
				if (d?.open) d.close("");
				d?.remove();
			};
			const nsSessions = (cardId) => {
				const ws = ctx.workspaces.list.getSnapshot();
				const arch = new Set(ws.archivedSessionIds ?? []);
				const owner = /* @__PURE__ */ new Map();
				for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, w.title);
				const st = ctx.sessions.list.getSnapshot();
				return (ns?.snap.board.sessions ?? []).filter((s) => s.cardId === cardId).flatMap((r) => {
					const s = st.byId[r.sessionId];
					return s ? [{
						id: r.sessionId,
						title: s.title || s.displayTitle || r.title || r.sessionId,
						ws: owner.get(r.sessionId) ?? "未分组",
						updatedAt: s.updatedAt,
						archived: arch.has(r.sessionId)
					}] : [];
				}).sort((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt - a.updatedAt);
			};
			const renderNs = () => {
				if (!ns) return;
				const b = ns.snap.board;
				const c = b.cards.find((x) => x.id === ns.card);
				const g = c && b.groups.find((x) => x.id === c.g);
				if (!c || !g) {
					closeNs();
					toast("卡片已不存在", "err");
					return;
				}
				const mem = (/* @__PURE__ */ new Set([...g.links, ...c.links])).size;
				const list = nsSessions(c.id);
				if (ns.sel !== "__new" && !list.some((s) => s.id === ns.sel && !s.archived)) ns.sel = "__new";
				const st = ns.snap.states ?? [];
				const sug = mem ? null : st.filter((x) => x.slug.length >= 6 && c.t.toLowerCase().includes(x.slug.toLowerCase())).sort((a, z) => z.slug.length - a.slug.length)[0];
				const canRestore = ns.snap.caps?.unarchive !== false;
				const row = (s) => "<label class=\"ns-row" + (s.archived ? " dis" : "") + (s.id === ns.fresh ? " fresh" : "") + "\"" + (s.archived ? " title=\"已归档的会话不能直接打开，先「恢复活跃」\"" : "") + "><input type=\"radio\" name=\"dpmNs\" value=\"" + esc(s.id) + "\"" + (s.archived ? " disabled" : "") + (ns.sel === s.id ? " checked" : "") + "><span class=\"txt\"><span class=\"nm\">" + esc(s.title) + "</span><span class=\"sub\">" + (s.archived ? "<span class=\"chip arch\">已归档</span>" : "<span class=\"chip live\">活跃</span>") + "<span>" + esc(s.ws) + " · " + esc(ago(s.updatedAt)) + "</span></span></span>" + (s.archived ? "<button type=\"button\" class=\"btn ghost xs\" data-ns-restore=\"" + esc(s.id) + "\"" + (canRestore && !ns.busy.has(s.id) ? "" : " disabled") + " title=\"" + (canRestore ? "恢复到工作区原来的位置" : "当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）") + "\">" + ic("restore") + (ns.busy.has(s.id) ? "恢复中…" : "恢复活跃") + "</button>" : "") + "</label>";
				ns.dlg.querySelector("#dpmNsP").innerHTML = esc(g.name) + " · <b>" + esc(c.t) + "</b>";
				ns.dlg.querySelector("#dpmNsList").innerHTML = (sug ? "<div class=\"ns-sug\">" + ic("info") + "<span class=\"grow\">这张卡片还没关联落盘项目。发现同名落盘项目 <b>" + esc(sug.slug) + "</b></span><button type=\"button\" class=\"btn xs\" data-ns-link=\"" + esc(sug.key) + "\">" + ic("link") + "关联到卡片</button></div>" : "") + "<label class=\"ns-row new\"><input type=\"radio\" name=\"dpmNs\" value=\"__new\"" + (ns.sel === "__new" ? " checked" : "") + "><span class=\"ni\">" + ic("plus") + "</span><span class=\"txt\"><span class=\"nm\">新建一个会话</span><span class=\"sub\"><span>在「" + esc(HUB_TITLE + " / " + g.name) + "」新建，名称「" + esc(treeMode() ? c.t : g.name + " · " + c.t) + "」，自动关联这张卡片 · " + (mem ? "读取 " + mem + " 个落盘项目的记忆" : "不读取记忆（未关联落盘项目）") + " · 完全权限</span></span></span></label><div class=\"ns-sec\">已关联的会话 · " + list.length + "</div>" + (list.length ? list.map(row).join("") : "<div class=\"ns-empty\">这张卡片还没有关联会话</div>");
				ns.fresh = void 0;
			};
			const openNs = (cardId, snap) => {
				closeNs();
				const dlg = document.createElement("dialog");
				dlg.className = "dpm-dialog wide";
				dlg.setAttribute("aria-labelledby", "dpmNsT");
				dlg.innerHTML = "<form method=\"dialog\"><div class=\"dlg-h\"><h2 id=\"dpmNsT\">新建会话</h2><p id=\"dpmNsP\"></p></div><div class=\"dlg-b\"><div id=\"dpmNsList\" role=\"radiogroup\" aria-labelledby=\"dpmNsT\"></div></div><div class=\"dlg-f\"><span class=\"meta\">双击一项可直接打开</span><span class=\"sp\"></span><button class=\"btn\" type=\"button\" data-ns-cancel>取消</button><button class=\"btn primary\" type=\"submit\" value=\"ok\">" + ic("play") + "打开会话</button></div></form>";
				document.body.append(dlg);
				ns = {
					dlg,
					card: cardId,
					sel: "__new",
					snap,
					busy: /* @__PURE__ */ new Set()
				};
				renderNs();
				dlg.addEventListener("change", (e) => {
					const t = e.target;
					if (ns && t.name === "dpmNs") ns.sel = t.value;
				});
				dlg.addEventListener("dblclick", (e) => {
					const r = e.target.closest(".ns-row:not(.dis)");
					if (r && ns) {
						ns.sel = r.querySelector("input").value;
						dlg.close("ok");
					}
				});
				dlg.addEventListener("click", (e) => {
					const t = e.target.closest("button");
					if (!t || !ns) return;
					if (t.dataset.nsCancel !== void 0) {
						dlg.close("");
						return;
					}
					if (t.dataset.nsRestore) {
						e.preventDefault();
						restoreNs(t.dataset.nsRestore);
						return;
					}
					if (t.dataset.nsLink) {
						e.preventDefault();
						linkNs(t.dataset.nsLink);
					}
				});
				dlg.addEventListener("close", () => {
					const cur = ns;
					if (!cur || cur.dlg !== dlg) return;
					const ok = dlg.returnValue === "ok";
					ns = null;
					dlg.remove();
					if (!ok) return;
					if (cur.sel === "__new") newSession(cur.card);
					else openAndReveal(cur.sel);
				});
				dlg.showModal();
				dlg.querySelector("input:checked")?.focus();
			};
			const restoreNs = async (sessionId) => {
				if (!ns || ns.busy.has(sessionId)) return;
				ns.busy.add(sessionId);
				renderNs();
				try {
					const r = await post("session/unarchive", { sessionId });
					if (!ns) return;
					ns.snap = r;
					ns.fresh = sessionId;
					toast(r.result.restored ? "已恢复，现在可以选择打开" : "这个会话已经是活跃状态");
				} catch (e) {
					toast("恢复失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				} finally {
					if (ns) {
						ns.busy.delete(sessionId);
						renderNs();
						ns.dlg.querySelector("input[value=\"" + CSS.escape(sessionId) + "\"]")?.focus();
					}
				}
			};
			const linkNs = async (key) => {
				if (!ns) return;
				const c = ns.snap.board.cards.find((x) => x.id === ns.card);
				if (!c) return;
				try {
					ns.snap = await post("card/update", {
						id: c.id,
						links: [...c.links, key]
					});
					renderNs();
					toast("已关联落盘项目，新会话会自动读取记忆");
				} catch (e) {
					toast("关联失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				}
			};
			ctx.effect(() => {
				let raf = 0;
				const on = () => {
					if (!ns || raf) return;
					raf = requestAnimationFrame(() => {
						raf = 0;
						renderNs();
					});
				};
				const a = ctx.sessions.list.subscribe(on);
				const b = ctx.workspaces.list.subscribe(on);
				return () => {
					a();
					b();
					if (raf) cancelAnimationFrame(raf);
					closeNs();
				};
			}, "dsh-project-manager: new-session dialog");
			const live = {
				snap: null,
				subs: /* @__PURE__ */ new Set(),
				refresh: async () => {}
			};
			live.refresh = async () => {
				try {
					const r = await getState(live.snap ? live.snap.rev : void 0);
					if (r.same) return;
					live.snap = r;
					if (r.hub?.title) HUB_TITLE = r.hub.title;
					for (const f of live.subs) f();
				} catch {}
			};
			ctx.effect(() => {
				live.refresh();
				const t = setInterval(() => {
					if (!document.hidden) live.refresh();
				}, 5e3);
				return () => clearInterval(t);
			}, "dsh-project-manager: snapshot poll");
			const bridge = new SidebarBridge({
				rows: () => {
					const h = live.snap?.hub;
					const groups = {};
					for (const [g, w] of Object.entries(h?.groups ?? {})) groups[w] = g;
					return {
						hub: h?.workspaceId ?? null,
						groups
					};
				},
				pickCard: (a, g) => void pickCard(a, g)
			});
			ctx.effect(() => {
				bridge.start();
				return () => bridge.stop();
			}, "dsh-project-manager: sidebar");
			/** 0.11：会话所在的工作区 id（没归到任何工作区 = null）。 */
			const ownerOf = (sessionId) => {
				for (const w of ctx.workspaces.list.getSnapshot().items) if (w.sessionIds?.includes(sessionId)) return w.workspaceId;
				return null;
			};
			/** 0.11：从看板进入会话（打开已有 / 新建）——打开后，会话所在的卡片组或「项目区」在侧栏收起着就展开。其他工作区的会话不动。 */
			const openAndReveal = (sessionId, wsId) => {
				ctx.uiWorkspace.openSession(sessionId);
				const h = live.snap?.hub;
				const ws = wsId ?? ownerOf(sessionId);
				if (!h || !ws || ws !== h.workspaceId && !Object.values(h.groups ?? {}).includes(ws)) return;
				bridge.reveal(sessionId, ws, h.workspaceId ?? null);
			};
			ctx.effect(() => {
				let raf = 0;
				const paint = () => {
					raf = 0;
					const h = live.snap?.hub;
					if (!h) return bridge.paint(null, {});
					const ws = ctx.workspaces.list.getSnapshot();
					const arch = new Set(ws.archivedSessionIds ?? []);
					const byId = ctx.sessions.list.getSnapshot().byId;
					const counts = {};
					for (const wid of Object.values(h.groups ?? {})) counts[wid] = (ws.items.find((x) => x.workspaceId === wid)?.sessionIds ?? []).filter((id) => !arch.has(id) && !byId[id]?.parentId && byId[id]?.origin !== "subagent").length;
					bridge.paint(h.workspaceId ?? null, counts);
				};
				const on = () => {
					if (!raf) raf = requestAnimationFrame(paint);
				};
				const a = ctx.sessions.list.subscribe(on);
				const b = ctx.workspaces.list.subscribe(on);
				live.subs.add(on);
				on();
				return () => {
					a();
					b();
					live.subs.delete(on);
					if (raf) cancelAnimationFrame(raf);
				};
			}, "dsh-project-manager: group counts");
			/**
			* 0.10：在看板里归档会话后留在看板。dsh 的导航策略在「主视图当前会话被归档」时 clearMain → selectPanel(null)，
			* 把看板面板关掉、落到新建会话页；归档期间若看板是当前面板，它被关掉的第一次立刻重新选回（只拦一次，返回释放函数）。
			*/
			const keepBoard = () => {
				const pi = ctx.layout.panelInfo;
				if (!pi || typeof pi.subscribe !== "function" || pi.getSnapshot().activePanelId !== PANEL) return () => void 0;
				let off = null;
				off = pi.subscribe(() => {
					if (pi.getSnapshot().activePanelId !== null) return;
					off?.();
					off = null;
					ctx.layout.selectPanel(PANEL);
				});
				return () => {
					off?.();
					off = null;
				};
			};
			const Board = (props) => {
				const ref = (0, react.useRef)(null);
				const [, bump] = (0, react.useState)(0);
				(0, react.useEffect)(() => {
					const el = ref.current;
					if (!el) return;
					const view = new BoardView(el, {
						newSession,
						openSession: (id) => openAndReveal(id),
						isDark,
						setDark,
						toast,
						pickCard: (a, g) => void pickCard(a, g),
						workspaces: () => {
							const items = ctx.workspaces.list.getSnapshot().items;
							const hubPath = view.snap?.hub.path;
							const inHub = (p) => !!hubPath && (p === hubPath || p.startsWith(hubPath.replace(/[/\\]+$/, "") + "/") || p.startsWith(hubPath.replace(/[/\\]+$/, "") + "\\"));
							return items.filter((w) => !inHub(w.path)).map((w) => ({
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
						archiveSession: async (id, stop) => {
							const w = ctx.workspaces;
							if (typeof w.archiveSession !== "function") throw new Error("当前 dsh 版本没有 workspaces.archiveSession");
							const release = keepBoard();
							try {
								await w.archiveSession(id, stop ? { stopActivity: true } : {});
								return { ok: true };
							} catch (e) {
								const re = e;
								if (!stop && re?.name === "WorkspaceArchiveError" && re.rpcError?.code === "workspace/session-active") return {
									ok: false,
									activity: re.rpcError.details?.activity ?? []
								};
								throw e;
							} finally {
								setTimeout(release, 800);
							}
						},
						unarchiveSession: async (id) => {
							const w = ctx.workspaces;
							if (typeof w.unarchiveSession !== "function") throw new Error("当前 dsh 版本没有 workspaces.unarchiveSession");
							await w.unarchiveSession(id);
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
						if (raf) return;
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
						live.refresh();
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
			const Entry = (p) => {
				const [n, setN] = (0, react.useState)(() => live.snap ? doingCount(live.snap.board) : 0);
				(0, react.useEffect)(() => {
					const f = () => setN(live.snap ? doingCount(live.snap.board) : 0);
					live.subs.add(f);
					f();
					return () => {
						live.subs.delete(f);
					};
				}, []);
				return (0, react.createElement)(BoardEntry, {
					active: !!p.active,
					compact: (p.size ?? 16) > 16,
					count: n
				});
			};
			ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL,
				order: 5,
				label: "项目看板"
			}, Entry)), "dsh-project-manager: board entry");
			const Dock = (props) => {
				const viaHook = props.useSession ? props.useSession((s) => s?.id ?? s?.sessionId) : void 0;
				const sessionId = props.sessionId ?? viaHook;
				const [info, setInfo] = (0, react.useState)(null);
				const [open, setOpen] = (0, react.useState)(false);
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
				const ma = info.materials;
				const maList = ma ? [
					ma.notes ? "相关说明" : "",
					ma.links ? ma.links + " 条相关链接" : "",
					ma.files ? ma.files + " 个相关文件" : ""
				].filter(Boolean) : [];
				if (!mem.length) {
					const sug = info.suggest;
					const link = async () => {
						try {
							const c = (await getState()).board.cards.find((x) => x.id === info.card.id);
							if (!c || !sug) return;
							await post("card/update", {
								id: c.id,
								links: [...c.links, sug.key]
							});
							setInfo(await getSession(sessionId));
							toast("已关联落盘项目，下一轮起自动读取");
						} catch (e) {
							toast("关联失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
						}
					};
					return (0, react.createElement)("div", { className: "dpm-dock nolink" }, (0, react.createElement)("div", { className: "dock-h" }, (0, react.createElement)("span", {
						className: "grow",
						title: info.card.group + " / " + info.card.title,
						dangerouslySetInnerHTML: { __html: ic("mem") + esc((sug ? "这张卡片还没关联落盘项目，发现同名的 " + sug.slug : "这张卡片没有关联落盘项目，会话不读取记忆") + (maList.length ? "；卡片资料（" + maList.join("、") + "）照常带上" : "")) }
					}), sug ? (0, react.createElement)("button", {
						type: "button",
						className: "btn xs",
						onClick: () => void link(),
						dangerouslySetInnerHTML: { __html: ic("link") + "关联" }
					}) : null));
				}
				const readN = mem.filter((m) => m.read).length;
				const fresh = mem.length - readN;
				const head = (fresh ? "已自动读取 " + fresh + " 个落盘项目的记忆" : "关联的落盘项目本会话都读过了") + (readN ? "，" + readN + " 个已读过不重复读取" : "") + (maList.length ? "，并带上卡片资料" : "");
				return (0, react.createElement)("div", { className: "dpm-dock" + (open ? " open" : "") }, (0, react.createElement)("button", {
					type: "button",
					className: "dock-h",
					"aria-expanded": open,
					onClick: () => setOpen(!open)
				}, (0, react.createElement)("span", {
					className: "grow",
					title: info.card.group + " / " + info.card.title,
					dangerouslySetInnerHTML: { __html: ic("mem") + esc(head) }
				}), (0, react.createElement)("span", {
					className: "chev",
					dangerouslySetInnerHTML: { __html: ic("chev") }
				})), open ? (0, react.createElement)("ul", null, mem.map((m) => (0, react.createElement)("li", { key: m.key }, (0, react.createElement)("b", null, m.slug), (0, react.createElement)("span", null, m.read ? "本会话已读过，不重复读取" : m.found ? m.next || "暂无下一步" : "未找到 STATE"))), maList.length ? (0, react.createElement)("li", { key: "__materials" }, (0, react.createElement)("b", null, "卡片资料"), (0, react.createElement)("span", null, maList.join("、"))) : null) : null);
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
		exports.treeMode = treeMode;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map