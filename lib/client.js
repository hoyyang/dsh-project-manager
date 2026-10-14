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
		const getRaw = (id) => call("/session/raw?id=" + encodeURIComponent(id));
		const getMergePreview = (session, keys, name) => call("/merge/preview?session=" + encodeURIComponent(session) + "&keys=" + encodeURIComponent(keys.join(",")) + "&name=" + encodeURIComponent(name));
		const getMatch = (session, q) => call("/landfill/match?session=" + encodeURIComponent(session) + "&q=" + encodeURIComponent(q));
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
			save: "<path d=\"M12 4v10m0 0-4-4m4 4 4-4\"/><path d=\"M5 19h14\"/>",
			refresh: "<path d=\"M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5\"/>",
			clip: "<rect x=\"8\" y=\"3\" width=\"8\" height=\"4\" rx=\"1\"/><path d=\"M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2\"/>",
			alert: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 8v5M12 16.5v.5\"/>",
			minus: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M8 12h8\"/>",
			ext: "<path d=\"M14 4h6v6M20 4l-9 9\"/><path d=\"M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4\"/>",
			merge: "<path d=\"M6 3v4a5 5 0 0 0 5 5h1\"/><path d=\"M18 3v4a5 5 0 0 1-5 5h-1v9\"/><path d=\"m8.5 17.5 3.5 3.5 3.5-3.5\"/>",
			undo: "<path d=\"M3 12a9 9 0 1 0 3-6.7L3 8\"/><path d=\"M3 3v5h5\"/>",
			stop: "<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/>",
			ask: "<path d=\"M4 5h16v11H9l-5 4Z\"/>"
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
		const FP_WHY = {
			ok: "存在",
			dir: "是文件夹（文件夹请加到「仓库」）",
			missing: "文件不存在",
			linked: "已关联",
			dup: "重复，已忽略",
			bad: "不是绝对路径"
		};
		const FP_ICON = {
			ok: "check",
			dir: "alert",
			missing: "alert",
			linked: "minus",
			dup: "minus",
			bad: "alert"
		};
		const fpKind = (s) => s === "ok" ? "ok" : s === "linked" || s === "dup" ? "skip" : "bad";
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
		/** 0.12：列表折叠时只取前 limit 项；超出时给出「展示更多 / 折叠」按钮（k = sess | mem）。 */
		function limitList(list, all, limit = 3) {
			return all || list.length <= limit ? list : list.slice(0, limit);
		}
		const moreBtn = (k, all, n, ctl, limit = 3) => n > limit ? "<button type=\"button\" class=\"more-tg\" data-more=\"" + k + "\" aria-expanded=\"" + all + "\" aria-controls=\"" + ctl + "\">" + (all ? "折叠" : "展示更多（还有 " + (n - limit) + " 项）") + ic("chev") + "</button>" : "";
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
		const hasMaterials = (c) => !!(c.notes ?? "").trim() || !!(c.webLinks ?? []).length || !!(c.files ?? []).length || !!(c.repos ?? []).length || !!c.tasks.length;
		/** 0.14 与服务端 urlKey 同口径：协议 + 域名（小写）+ 路径（去掉末尾 /）+ 查询 + 锚点。 */
		function urlKey(url) {
			try {
				const u = new URL(url);
				return u.protocol + "//" + u.host.toLowerCase() + u.pathname.replace(/\/+$/, "") + u.search + u.hash;
			} catch {
				return url.trim();
			}
		}
		/** 「N 天前添加过」 */
		function addedAgo(at, now = Date.now()) {
			const d = Math.floor((now - Date.parse(at)) / 864e5);
			return !Number.isFinite(d) ? "" : d <= 0 ? "今天添加过" : d === 1 ? "昨天添加过" : d + " 天前添加过";
		}
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
			syncing = false;
			/** 0.15：右上角「正在同步…」，只在首次同步超过 300ms 时出现（快的时候不闪）。 */
			syncTimer = 0;
			syncBadge() {
				const b = this.root.querySelector(".pm-sync");
				if (!b) return;
				clearTimeout(this.syncTimer);
				if (!this.syncing) {
					b.classList.remove("on");
					return;
				}
				this.syncTimer = window.setTimeout(() => {
					if (this.syncing) b.classList.add("on");
				}, 300);
			}
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
			/** 添加仓库弹窗：mode=group → 卡片组的「卡片共用仓库」；mode=card → 这张卡片自己的仓库（id = 组 id / 卡片 id）。 */
			ar = null;
			/** 「关联已有会话」弹窗草稿；cf = 待确认解除关联的会话。 */
			ls = null;
			cf = null;
			restoring = /* @__PURE__ */ new Set();
			/** 相关说明编辑态（card = 正在编辑的卡片，draft = 草稿）；没保存过的卡片始终是输入框。 */
			noteEdit = null;
			/** 相关文件：系统选文件框打开中 / 降级为手输路径。 */
			filePicking = false;
			/** 0.15 粘贴路径：card = 打开在哪张卡片；text = 输入框内容；res = 服务端逐行检测结果（与 text 同步）。 */
			fp = null;
			fpTimer = 0;
			chipSig = "";
			/** 展开了「已归档卡片」列表的卡片组（默认全部收起，只在本次打开期间记住）。 */
			tray = /* @__PURE__ */ new Set();
			/** 等待「停止并归档」确认的会话。 */
			sa = null;
			/** 0.10：展开了完整「相关说明」的卡片（本次打开期间记住）。 */
			noteOpen = /* @__PURE__ */ new Set();
			/** 0.11：「关联的落盘项目」是否展开详情（全部卡片共用一个开关，本次打开期间记住，默认只显示标题）。 */
			memOpen = false;
			/** 0.12：当前卡片的两个列表是否「展示更多」（切换卡片回到默认 3 项）。 */
			more = {
				card: "",
				sess: false,
				mem: false
			};
			moreOf(c) {
				if (this.more.card !== c.id) this.more = {
					card: c.id,
					sess: false,
					mem: false
				};
				return this.more;
			}
			/** 0.10：「添加 / 编辑相关链接」弹窗草稿。 */
			wl = null;
			/** 0.10：相关链接拖动排序（pointer：按住手柄拖动，松开落位，Esc 取消）。 */
			wd = null;
			constructor(root, host) {
				this.root = root;
				this.host = host;
				root.classList.add("dpm");
				root.innerHTML = "<div class=\"pm-top\"></div><div class=\"pm-body\"><div class=\"board-wrap\"></div></div>" + DIALOGS.replace("%FOLDER%", ic("fplus")).replaceAll("%PLUS%", ic("plus"));
				this.bind();
				const seed = host.seed?.() ?? null;
				if (seed) {
					this.snap = seed;
					this.render();
				} else this.render();
				queueMicrotask(() => {
					if (this.wantCard && this.snap) this.focusCard(this.wantCard);
				});
				this.syncing = true;
				this.syncBadge();
				this.refresh().finally(() => {
					this.syncing = false;
					this.syncBadge();
				});
				this.timer = setInterval(() => {
					if (!document.hidden) this.refresh(true);
				}, 4e3);
			}
			/** 0.19 从会话信息卡直达：选中卡片、打开详情、滚到它、闪一下蓝框（快照还没到就等下一次渲染）。 */
			wantCard = null;
			async focusCard(id) {
				if (!this.card(id)) {
					this.wantCard = id;
					return;
				}
				this.wantCard = null;
				const c = this.card(id);
				if (c.archivedAt) this.tray.add(c.g);
				if (this.sel !== id) {
					this.noteEdit = null;
					this.fp = null;
				}
				this.sel = id;
				if (this.grp(c.g)?.collapsed) await this.act("group/update", {
					id: c.g,
					collapsed: false
				});
				else this.render();
				const wrap = this.root.querySelector(".board-wrap");
				const el = wrap?.querySelector("[data-card=\"" + CSS.escape(id) + "\"]");
				if (!wrap || !el) return;
				const wr = wrap.getBoundingClientRect();
				const er = el.getBoundingClientRect();
				wrap.scrollTo({
					top: Math.max(0, wrap.scrollTop + er.top - wr.top - Math.max(16, (wrap.clientHeight - er.height) / 2)),
					behavior: "smooth"
				});
				const lane = el.closest(".lane-in");
				if (lane) {
					const lr = lane.getBoundingClientRect();
					if (er.left < lr.left || er.right > lr.right) lane.scrollTo({
						left: Math.max(0, lane.scrollLeft + er.left - lr.left - 16),
						behavior: "smooth"
					});
				}
				el.classList.remove("dpm-flash");
				el.offsetWidth;
				el.classList.add("dpm-flash");
				setTimeout(() => el.classList.remove("dpm-flash"), 1400);
			}
			dispose() {
				this.disposed = true;
				if (this.timer) clearInterval(this.timer);
				clearTimeout(this.syncTimer);
				clearTimeout(this.fpTimer);
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
					if (this.wantCard) this.focusCard(this.wantCard);
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
				if (!top.firstChild) top.innerHTML = "<div class=\"ttl\"><h1>项目看板<span class=\"pm-sync\" role=\"status\"><span class=\"dot\" aria-hidden=\"true\"></span>正在同步…</span></h1><p>一张卡片对应一个落盘项目，卡片组就是父项目。每个卡片组有自己的一套阶段。</p></div><label class=\"search\">" + ic("search") + "<span class=\"sr-only\">搜索卡片</span><input id=\"dpmQ\" type=\"search\" placeholder=\"搜索卡片或仓库\" value=\"" + esc(this.q) + "\"></label><button type=\"button\" class=\"btn\" data-import>" + ic("import") + "导入落盘项目</button><button type=\"button\" class=\"btn primary\" data-new-group>" + ic("plus") + "新建卡片组</button><button type=\"button\" class=\"ib\" data-theme-toggle></button>";
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
					wrap.innerHTML = (this.err ? "<div class=\"dpm-err\" role=\"alert\">" + esc(this.err) + "</div>" : "") + this.lfNoteHtml() + this.boardHtml();
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
					if ((document.activeElement?.id === "dpmNoteIn" || document.activeElement?.id === "dpmFpIn") && old.contains(document.activeElement)) return;
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
				if (!this.snap) return "<div class=\"skel-board\" aria-busy=\"true\" aria-label=\"正在加载看板\">" + [0, 1].map(() => "<div class=\"lane skel-lane\"><div class=\"skel-h\"></div><div class=\"skel-row\">" + [
					0,
					1,
					2
				].map(() => "<div class=\"skel\"></div>").join("") + "</div></div>").join("") + "</div>";
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
					return "<section class=\"lane" + (g.collapsed ? " collapsed" : "") + "\" data-lane=\"" + esc(g.id) + "\"><div class=\"lane-h\"><div class=\"lane-hit\" data-toggle-area=\"" + esc(g.id) + "\"><h2><button type=\"button\" class=\"tg\" data-toggle=\"" + esc(g.id) + "\" aria-expanded=\"" + !g.collapsed + "\"><span class=\"chev-b\"><svg class=\"i chev\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m6 9 6 6 6-6\"/></svg></span><span class=\"nm\">" + esc(g.name) + "</span></button></h2>" + this.statHtml(g, cs) + (g.links.length ? "<button type=\"button\" class=\"chip mem as-btn\" data-edit-group=\"" + esc(g.id) + "\" data-focus-links>" + ic("mem") + "<span class=\"lb\">组记忆 </span>" + g.links.length + "</button>" : "") + "</div><button type=\"button\" class=\"btn ghost\" data-edit-group=\"" + esc(g.id) + "\">" + ic("sliders") + "卡片组设置</button><button type=\"button\" class=\"btn ghost\" data-new-in=\"" + esc(g.id) + "\">" + ic("plus") + "新会话</button><button type=\"button\" class=\"btn ghost\" data-tray=\"" + esc(g.id) + "\" aria-expanded=\"" + open + "\" aria-controls=\"dpmTray-" + esc(g.id) + "\">" + ic("archive") + "已归档卡片<span class=\"cnt\">" + ar.length + "</span></button><button type=\"button\" class=\"ib grip tipbtn\" data-gdrag=\"" + esc(g.id) + "\" aria-label=\"调整「" + esc(g.name) + "」的顺序：按住拖动，或 Alt+上下方向键\">" + ic("grip") + "<span class=\"tip\" aria-hidden=\"true\">按住拖动排序</span></button></div>" + (open ? this.trayHtml(g, ar) : "") + "<div class=\"lane-in\" data-g=\"" + esc(g.id) + "\">" + head + "<div class=\"lane-b\" style=\"--cols:" + n + "\">" + bodyHtml + "</div></div></section>";
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
				const mo = this.moreOf(c);
				const memRows = limitList(mem, mo.mem).map((m) => {
					const s = this.stateOf(m.k);
					const tag = m.from === "group" ? "<span class=\"chip plain\">来自卡片组</span>" : m.from === "both" ? "<span class=\"chip plain\">卡片组 + 卡片</span>" : "<span class=\"chip brand\">卡片</span>";
					const rm = !ro && m.from !== "group" ? "<button type=\"button\" class=\"ib\" data-unlink-card=\"" + esc(m.k) + "\" aria-label=\"取消关联 " + esc(m.k) + "\">" + ic("x") + "</button>" : "";
					if (!s) return "<div class=\"mrow\"><div class=\"txt\"><div class=\"nm\" title=\"" + esc(m.k) + "\">" + esc(m.k) + "</div><div class=\"more\"><p class=\"l\">未找到这个落盘项目的 STATE（可能已移动或删除）</p></div></div><div class=\"mside\">" + tag + rm + "</div></div>";
					return "<div class=\"mrow\"><div class=\"txt\"><div class=\"nm mq\" title=\"" + esc(s.slug) + "\">" + esc(s.slug) + "</div><div class=\"more\"><span class=\"mono\">" + esc(s.project) + " · 更新于 " + esc(s.updated) + "</span><p class=\"l\">" + esc(s.status || "暂无状态说明") + "</p><p class=\"nx\"><b>next_action</b>" + esc(s.next || "暂无下一步") + "</p></div></div><div class=\"mside\">" + tag + rm + "</div></div>";
				}).join("");
				const memBody = memRows ? "<div class=\"mlist" + (this.memOpen ? " open" : "") + "\" id=\"dpmMemList\">" + memRows + "</div>" + moreBtn("mem", mo.mem, mem.length, "dpmMemList") : "<p class=\"meta\">还没有关联落盘项目。会话不会自动读取任何记忆。</p>";
				const memTg = memRows ? "<button type=\"button\" class=\"btn ghost sm mem-tg\" data-mem-toggle aria-expanded=\"" + this.memOpen + "\" aria-controls=\"dpmMemList\">" + (this.memOpen ? "收起详情" : "展开详情") + ic("chev") + "</button>" : "";
				const shared = new Set(g.repos.map((r) => normPath(r.path)));
				const crs = c.repos ?? [];
				const repos = crs.map((r, i) => "<div class=\"repo\">" + ic("repo") + "<div class=\"txt\"><div class=\"nm mq\">" + esc(r.name) + "</div><span class=\"mono mq\" title=\"" + esc(r.path) + "\">" + esc(r.path) + "</span></div>" + (shared.has(normPath(r.path)) ? "<span class=\"from\" title=\"也在卡片组「" + esc(g.name) + "」的卡片共用仓库里\">本组共用</span>" : "") + "<span class=\"chip " + (r.role === "主仓" ? "brand" : "plain") + "\">" + esc(r.role) + "</span>" + (ro ? "" : "<button type=\"button\" class=\"ib sm\" data-card-repo-del=\"" + i + "\" aria-label=\"从这张卡片移除 " + esc(r.name) + "\">" + ic("x") + "</button>") + "</div>").join("");
				const repoBody = repos ? repos + (ro ? "" : "<p class=\"meta\">移除只影响这张卡片，卡片组的共用仓库和其他卡片不变。</p>") : "<p class=\"ar-empty\">" + (ro ? "没有仓库。" : "这张卡片还没有仓库。点「新增仓库」，可以一键带上卡片组的共用仓库。") + "</p>";
				const tasks = c.tasks.map((t, k) => "<div class=\"task" + (t.done ? " done" : "") + "\"><label><input type=\"checkbox\"" + (ro ? " disabled" : " data-task=\"" + k + "\"") + (t.done ? " checked" : "") + "><span>" + esc(t.text) + "</span></label>" + (ro ? "" : "<button type=\"button\" class=\"ib sm\" data-task-del=\"" + k + "\" aria-label=\"删除子任务 " + esc(t.text) + "\">" + ic("x") + "</button>") + "</div>").join("");
				const sess = this.linkedHtml(c, ro);
				return "<aside class=\"detail" + (ro ? " ro" : "") + "\" data-card=\"" + esc(c.id) + "\" aria-labelledby=\"dpmDT\"><div class=\"d-h\"><div class=\"grow\" style=\"white-space:normal\"><h2 id=\"dpmDT\">" + esc(c.t) + "</h2><div class=\"sub\">" + esc(g.name) + " · " + esc(sts[i]?.name ?? "") + "</div></div>" + (ro ? "" : "<button type=\"button\" class=\"ib\" data-rename-card aria-label=\"重命名卡片\">" + ic("pencil") + "</button><button type=\"button\" class=\"ib tipbtn\" data-archive-card=\"" + esc(c.id) + "\" aria-label=\"归档这张卡片\">" + ic("archive") + "<span class=\"tip\" aria-hidden=\"true\">归档卡片</span></button>") + "<button type=\"button\" class=\"ib\" data-close aria-label=\"关闭详情\">" + ic("x") + "</button></div>" + (ro ? "<div class=\"arch-bar\"><span class=\"txt\"><b>已归档</b> · " + esc(daysAgo(c.archivedAt)) + "，只能查看</span><button type=\"button\" class=\"btn sm\" data-unarchive-card=\"" + esc(c.id) + "\">" + ic("unarchive") + "恢复活跃</button></div>" : "") + "<div class=\"d-b\"><section class=\"sec\"><h3>" + ic("play") + "本卡片的会话 · " + this.sessionsOf(c.id).length + "<span class=\"grow\"></span>" + (ro ? "" : "<button type=\"button\" class=\"btn ghost sm\" data-link-sess>" + ic("link") + "关联已有会话</button>") + "</h3>" + sess + "</section><section class=\"sec\"><h3>" + ic("mem") + "关联的落盘项目 · " + mem.length + "<span class=\"grow\"></span>" + memTg + (ro ? "" : "<button type=\"button\" class=\"btn ghost sm\" data-link-card>" + ic("plus") + "关联</button>") + "</h3>" + (ro ? "" : "<p class=\"meta mb\">会话会自动读取下面这些落盘项目的记忆。来自卡片组的在「卡片组设置」里改。</p>") + memBody + (ro ? "" : this.memActHtml(c, mem.length)) + "</section>" + this.notesHtml(c, ro) + this.webLinksHtml(c, ro) + this.filesHtml(c, ro) + "<section class=\"sec\"><h3>阶段</h3><div class=\"steps\">" + steps + "</div>" + (ro ? "" : nx ? "<button type=\"button\" class=\"btn primary lg\" data-next>推进到 " + esc(nx.name) + ic("arrow") + "</button>" : "<p class=\"meta\">已在最后一个阶段</p>") + "</section><section class=\"sec\"><h3>子任务 " + c.tasks.filter((t) => t.done).length + "/" + c.tasks.length + "</h3>" + tasks + (ro ? c.tasks.length ? "" : "<p class=\"meta\">没有子任务。</p>" : "<form class=\"addtask\" data-addtask><label class=\"sr-only\" for=\"dpmNewTask\">新子任务</label><input id=\"dpmNewTask\" placeholder=\"添加子任务，回车确认\" autocomplete=\"off\"><button class=\"btn\" type=\"submit\">添加</button></form>") + "</section><section class=\"sec\"><h3>" + ic("repo") + "仓库 · " + crs.length + "<span class=\"grow\"></span>" + (ro ? "" : "<button type=\"button\" class=\"btn ghost sm\" data-card-repo-add>" + ic("plus") + "新增仓库</button>") + "</h3>" + repoBody + "</section>" + (ro ? "</div></aside>" : "<section class=\"sec\"><button type=\"button\" class=\"btn ghost danger\" data-remove-card>" + ic("trash") + "删除这张卡片</button></section></div><div class=\"d-f\"><div class=\"note\"><span class=\"chip warn\">" + ic("shield") + "完全权限</span><span class=\"chip mem\">" + ic("mem") + "自动读取 " + mem.length + " 个落盘项目" + (hasMaterials(c) ? " + 卡片资料" : "") + "</span></div>" + (this.creating === c.id ? "<button type=\"button\" class=\"btn primary lg\" disabled aria-busy=\"true\"><span class=\"spin\" aria-hidden=\"true\"></span>正在新建会话…</button>" : "<button type=\"button\" class=\"btn primary lg\" data-open-card>" + ic("play") + "以此卡片新建会话</button>") + "</div></aside>");
			}
			/** 看板顶部一行提示：只在需要时出现（本机 skill 是单独一份 → 接管；功能没开 → 原因）。 */
			lfNoteHtml() {
				const lf = this.snap?.landfill;
				if (!lf || !lf.enabled) return "";
				if (!lf.ok) return "<div class=\"lf-note\" role=\"status\">" + ic("info") + "<span class=\"txt\">落盘项目功能没开启：<b>" + esc(lf.reason) + "</b>。看板其他功能照常。</span></div>";
				const up = lf.toolOutdated ? "<div class=\"lf-note\" role=\"status\">" + ic("info") + "<span class=\"txt\">本机的 <code>~/.ai/tools/ai-memory</code> 是旧版（v" + lf.toolVersion + "），不支持把截图等文件导入项目文件夹。升级 = 先备份，再换成插件自带的 v" + lf.bundledVersion + "（只新增命令，Codex 等其他工具照常用）。</span><button type=\"button\" class=\"btn sm\" data-lf-upgrade" + (this.upgrading ? " disabled" : "") + ">" + (this.upgrading ? "升级中…" : "升级 ai-memory") + "</button></div>" : "";
				if (lf.skill !== "file") return up;
				return up + "<div class=\"lf-note\" role=\"status\">" + ic("info") + "<span class=\"txt\">本机的 <code>" + esc(lf.skillPath.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~")) + "</code> 是单独一份，Codex 等其他工具读的不是插件里这份。接管 = 先备份，再换成指向插件的链接。</span><button type=\"button\" class=\"btn sm\" data-lf-adopt" + (this.adopting ? " disabled" : "") + ">" + (this.adopting ? "接管中…" : "接管") + "</button></div>";
			}
			adopting = false;
			upgrading = false;
			lfBusy = false;
			/** 卡片详情：回忆 / 落盘 两个按钮（发到这张卡片最近的会话）。 */
			memActHtml(c, memN) {
				const lf = this.snap?.landfill;
				if (!lf || !lf.enabled) return "";
				const off = !lf.ok;
				const last = this.lastLive(c.id);
				const hint = off ? "落盘项目功能没开启，见看板顶部说明。" : last ? "发到这张卡片最近的会话「" + esc(last.title) + "」" : "这张卡片还没有会话，会先新建一个";
				return "<div class=\"mem-act\"><button type=\"button\" class=\"btn sm\" data-lf-recall" + (off || !memN || this.lfBusy ? " disabled" : "") + (memN ? "" : " title=\"还没有关联落盘项目\"") + ">" + ic("restore") + "回忆</button><button type=\"button\" class=\"btn sm\" data-lf-persist" + (off || this.lfBusy ? " disabled" : "") + ">" + ic("save") + "落盘</button><p class=\"hint\">" + hint + "</p></div>";
			}
			/** 这张卡片最近更新的活跃会话（没有归档、宿主里还在）。 */
			lastLive(cardId) {
				const all = new Map(this.host.allSessions().map((s) => [s.id, s]));
				let best = null;
				for (const r of this.snap?.board.sessions ?? []) {
					if (r.cardId !== cardId) continue;
					const s = all.get(r.sessionId);
					if (s && !s.archived && (!best || s.updatedAt > best.updatedAt)) best = s;
				}
				return best ? {
					id: best.id,
					title: best.title
				} : null;
			}
			async lfSend(c, verb) {
				const keys = this.memOf(c).map((m) => this.stateOf(m.k)?.slug ?? m.k.split("/")[1]);
				const text = verb + " " + (keys.join("、") || "").trim();
				this.lfBusy = true;
				this.renderDetail();
				try {
					const t = await this.host.sendToCard(c.id, text.trim());
					this.host.toast("已发到「" + t + "」：" + text.trim());
				} catch (e) {
					this.host.toast((verb === "回忆" ? "回忆" : "落盘") + "失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				} finally {
					this.lfBusy = false;
					if (!this.disposed) this.renderDetail();
				}
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
						return b ? b.n + ":" + b.live : "-";
					}).join(",");
				} finally {
					this.idxCache = null;
				}
			}
			/** 0.20 卡片组标题旁统计：卡片数（蓝底，0 张变灰）+ 活跃会话数（本组卡片关联、没归档的会话，实时）+ 仓库 / 阶段（灰色小字）。 */
			liveLast = /* @__PURE__ */ new Map();
			statHtml(g, cs) {
				const idx = this.sessIndex();
				let live = 0;
				for (const c of this.cards.filter((x) => x.g === g.id && !x.archivedAt)) live += this.badgeOfIdx(c.id, idx)?.live ?? 0;
				const prev = this.liveLast.get(g.id);
				this.liveLast.set(g.id, live);
				const bump = prev !== void 0 && prev !== live;
				const n = cs.length;
				return "<span class=\"gstat\"><span class=\"cnt cards" + (n ? "" : " zero") + "\" title=\"" + (n ? n + " 张卡片（不含已归档）" : "还没有卡片") + "\"><b>" + n + "</b>张卡片</span><span class=\"cnt live" + (live ? "" : " zero") + (bump ? " bump" : "") + "\" title=\"" + (live ? "本组卡片关联的会话里，没归档的有 " + live + " 个（实时）" : "本组卡片没有活跃会话") + "\"><i aria-hidden=\"true\"></i><b>" + live + "</b><span class=\"lb\">活跃会话</span></span><span class=\"quiet\">" + g.repos.length + " 个仓库 · " + g.statuses.length + " 个阶段</span></span>";
			}
			badgeOfIdx(cardId, idx) {
				return sessBadge((this.snap?.board.sessions ?? []).filter((s) => s.cardId === cardId), idx);
			}
			/** 0.20「以此卡片新建会话」：点了立刻进入忙态（锁按钮），建好或失败后恢复。 */
			creating = null;
			setCreating(cardId) {
				this.creating = cardId;
				this.renderDetail();
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
				return "<section class=\"sec\">" + head + "<label class=\"sr-only\" for=\"dpmNoteIn\">相关说明</label><textarea class=\"note-in\" id=\"dpmNoteIn\" placeholder=\"写下和这个项目相关的任何说明：背景、约定、网址链接……不限字数\">" + esc(draft) + "</textarea><div class=\"note-bar\"><span class=\"meta\" id=\"dpmNoteN\">" + draft.length + " 字" + (saved ? " · 编辑中" : "") + "</span><span class=\"grow\"></span><button type=\"button\" class=\"btn sm\" data-note-clear" + (draft ? "" : " hidden") + " title=\"清空输入框（还没保存；按 ⌘Z 可以撤回）\">清空</button><button type=\"button\" class=\"btn primary sm\" data-note-save" + (dirty ? "" : " disabled") + ">保存</button></div></section>";
			}
			noteView(c, saved) {
				const open = this.noteOpen.has(c.id);
				return "<div class=\"note-wrap\" data-nwrap=\"" + esc(c.id) + "\"><div class=\"note-view\">" + linkify(saved) + "</div><button type=\"button\" class=\"btn ghost sm note-more\" data-note-more=\"" + esc(c.id) + "\" aria-expanded=\"" + open + "\" hidden>" + (open ? "收起" : "展开全部") + ic("chev") + "</button></div>";
			}
			/** 0.10 相关链接：完整列表（不折叠）；一行 = 拖动手柄 + 显示文字（点开 = 默认浏览器）+ 类型 + 编辑 / 删除。 */
			webLinksHtml(c, ro = false) {
				const ls = c.webLinks ?? [];
				const rows = ls.map((l, k) => "<div class=\"wl\" data-wl=\"" + k + "\">" + (ro ? "" : "<button type=\"button\" class=\"wgrip\" data-wdrag=\"" + k + "\" aria-label=\"拖动调整「" + esc(l.text) + "」的位置（键盘 Alt+上下方向键）\">" + ic("grip") + "</button>") + "<a class=\"wl-a" + (ro ? " ro" : "") + "\" href=\"" + esc(l.url) + "\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"" + esc(l.url) + "\">" + ic("ext") + "<span class=\"t mq\">" + esc(l.text) + "</span></a><span class=\"chip plain\">" + esc(l.type) + "</span><button type=\"button\" class=\"ib sm cp tipbtn\" data-copy-url=\"" + esc(l.url) + "\" aria-label=\"复制链接 " + esc(l.text) + "\"><svg class=\"cp-ico\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z\" fill=\"currentColor\"/></svg><svg class=\"cp-ck\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z\" fill=\"currentColor\"/></svg><span class=\"tip\" aria-hidden=\"true\">复制链接</span></button>" + (ro ? "" : "<span class=\"acts\"><button type=\"button\" class=\"ib sm tipbtn\" data-wl-edit=\"" + k + "\" aria-label=\"编辑 " + esc(l.text) + "\">" + ic("pencil") + "<span class=\"tip\" aria-hidden=\"true\">编辑</span></button><button type=\"button\" class=\"ib sm del tipbtn\" data-wl-del=\"" + k + "\" aria-label=\"删除 " + esc(l.text) + "\">" + ic("trash") + "<span class=\"tip\" aria-hidden=\"true\">删除</span></button></span>") + "</div>").join("");
				const body = ls.length ? "<div class=\"wl-list\">" + rows + "</div>" : "<p class=\"meta\">" + (ro ? "没有相关链接。" : "还没有相关链接。点「添加链接」可以一次加多条。") + "</p>";
				return "<section class=\"sec\"><h3>" + ic("link") + "相关链接 · " + ls.length + "<span class=\"grow\"></span>" + (ro ? "" : "<span class=\"h3-acts\"><button type=\"button\" class=\"btn ghost sm\" data-types>" + ic("sliders") + "管理类型</button><button type=\"button\" class=\"btn ghost sm\" data-wl-add>" + ic("plus") + "添加链接</button></span>") + "</h3>" + body + "</section>";
			}
			get linkTypes() {
				return this.snap?.board.linkTypes ?? ["文档", "代码"];
			}
			blankRow(type) {
				return {
					text: "",
					type: type ?? this.linkTypes[0],
					url: "",
					err: ""
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
						err: ""
					} : this.blankRow()]
				};
				this.$("#dpmWlT").textContent = mode === "edit" ? "编辑链接" : "添加相关链接";
				this.$("#dpmWlP").textContent = mode === "edit" ? "改完点保存。" : "可以一次加多条；在「完整链接」里粘贴多行网址会自动拆成多条。";
				this.$("#dpmWlMore").hidden = mode === "edit";
				this.wlRender();
				const d = this.$("#dpmDlgWl");
				d.returnValue = "";
				if (!d.open) d.showModal();
				this.root.querySelector("#dpmWlRows [data-wurl]")?.focus();
			}
			/** 类型下拉：只能选已有类型（0.13 起新增 / 改名统一走「管理类型」）。 */
			wlTypeCtl(r, i) {
				const ts = this.linkTypes.includes(r.type) ? this.linkTypes : [...this.linkTypes, r.type];
				return "<select class=\"fld\" id=\"dpmWt" + i + "\" data-wtype=\"" + i + "\">" + ts.map((t) => "<option" + (t === r.type ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select>";
			}
			wlRender() {
				const w = this.wl;
				if (!w) return;
				const rows = w.rows;
				this.$("#dpmWlRows").innerHTML = rows.map((r, i) => "<div class=\"wl-row\">" + (rows.length > 1 ? "<div class=\"wl-row-h\">第 " + (i + 1) + " 条<span class=\"grow\"></span><button type=\"button\" class=\"ib sm\" data-wl-rm=\"" + i + "\" aria-label=\"移除第 " + (i + 1) + " 条\">" + ic("x") + "</button></div>" : "") + "<div class=\"wl-grid\"><div><label class=\"lbl\" for=\"dpmWx" + i + "\">显示文字</label><input class=\"fld\" id=\"dpmWx" + i + "\" data-wtext=\"" + i + "\" value=\"" + esc(r.text) + "\" placeholder=\"不填就用网址\" maxlength=\"120\" autocomplete=\"off\"></div><div><label class=\"lbl\" for=\"dpmWt" + i + "\">类型</label>" + this.wlTypeCtl(r, i) + "</div><div class=\"full\"><label class=\"lbl\" for=\"dpmWu" + i + "\">完整链接</label><input class=\"fld" + (r.err ? " bad" : "") + "\" id=\"dpmWu" + i + "\" data-wurl=\"" + i + "\" value=\"" + esc(r.url) + "\" placeholder=\"https://…\" autocomplete=\"off\" inputmode=\"url\"" + (r.err ? " aria-invalid=\"true\" aria-describedby=\"dpmWe" + i + "\"" : "") + ">" + (r.err ? "<p class=\"wl-err\" id=\"dpmWe" + i + "\">" + esc(r.err) + "</p>" : "") + "<div class=\"wl-dup-slot\" id=\"dpmWd" + i + "\" aria-live=\"polite\"></div></div></div></div>").join("");
				this.$("#dpmWlCount").textContent = w.mode === "add" && rows.length > 1 ? "共 " + rows.length + " 条，空行不保存" : "";
				this.wlDupAll();
				this.wlOkText();
			}
			/**
			* 0.14 重复链接：和这张卡片已有的链接（编辑时不跟自己比）或本次前面的行是同一个 → 不能保存。
			* 返回 { at: 已有链接序号 | -1, row: 本次的第几行 | -1 }；不重复 → null。
			*/
			wlDupOf(i) {
				const w = this.wl;
				const c = w ? this.card(w.card) : void 0;
				const r = w?.rows[i];
				if (!w || !c || !r) return null;
				const v = checkUrl(r.url);
				if (!v.url) return null;
				const k = urlKey(v.url);
				const at = (c.webLinks ?? []).findIndex((l, j) => !(w.mode === "edit" && j === w.idx) && urlKey(l.url) === k);
				if (at >= 0) return {
					at,
					row: -1
				};
				const row = w.rows.slice(0, i).findIndex((o) => {
					const x = checkUrl(o.url);
					return !!x.url && urlKey(x.url) === k;
				});
				return row >= 0 ? {
					at: -1,
					row
				} : null;
			}
			wlDupAll() {
				const w = this.wl;
				const c = w ? this.card(w.card) : void 0;
				if (!w || !c) return;
				w.rows.forEach((_, i) => {
					const slot = this.root.querySelector("#dpmWd" + i);
					const inp = this.root.querySelector("#dpmWu" + i);
					if (!slot || !inp) return;
					const d = this.wlDupOf(i);
					const l = d && d.at >= 0 ? (c.webLinks ?? [])[d.at] : void 0;
					slot.innerHTML = !d ? "" : l ? "<div class=\"wl-dup\" role=\"alert\"><p class=\"h\">这张卡片已经添加过这个链接了，不能重复保存</p><dl><dt>显示文字</dt><dd>" + esc(l.text) + "</dd><dt>类型</dt><dd>" + esc(l.type) + "</dd><dt>完整链接</dt><dd>" + esc(l.url) + "</dd></dl><div class=\"a\"><button type=\"button\" class=\"btn sm\" data-wl-dup-edit=\"" + d.at + "\">" + ic("pencil") + "直接编辑这条已添加的链接</button><button type=\"button\" class=\"btn ghost sm\" data-wl-dup-back=\"" + i + "\">改成别的链接</button></div></div>" : "<p class=\"wl-err\" role=\"alert\">和第 " + (d.row + 1) + " 条是同一个链接，删掉一条再保存</p>";
					const bad = !!d || !!w.rows[i].err;
					inp.classList.toggle("bad", bad);
					if (bad) inp.setAttribute("aria-invalid", "true");
					else inp.removeAttribute("aria-invalid");
				});
				const dup = w.rows.some((_, i) => !!this.wlDupOf(i));
				this.$("#dpmWlOk").disabled = dup;
			}
			wlOkText() {
				const w = this.wl;
				if (!w) return;
				const n = w.rows.filter((r) => r.url.trim()).length;
				this.$("#dpmWlOk").textContent = w.mode === "add" && n > 1 ? "保存 " + n + " 条" : "保存";
			}
			/** 0.13「管理类型」：列出全局类型（附在用条数），新增 / 改名；保存即全局生效（改名连带所有卡片的链接）。 */
			ty = null;
			typeUse(t) {
				let n = 0;
				for (const c of this.cards) for (const l of c.webLinks ?? []) if (l.type === t) n++;
				return n;
			}
			typesOpen() {
				this.ty = {
					edit: -1,
					err: "",
					addErr: ""
				};
				this.typesRender();
				const d = this.$("#dpmDlgTy");
				d.returnValue = "";
				d.showModal();
				this.root.querySelector("#dpmTyNew")?.focus();
			}
			typesRender(focus) {
				const y = this.ty;
				if (!y) return;
				const keep = this.root.querySelector("#dpmTyNew")?.value ?? "";
				this.$("#dpmTyList").innerHTML = this.linkTypes.map((t, i) => {
					if (y.edit === i) return "<li class=\"ty-row editing\"><label class=\"sr-only\" for=\"dpmTyEd\">类型名称</label><input class=\"fld" + (y.err ? " bad" : "") + "\" id=\"dpmTyEd\" value=\"" + esc(t) + "\" maxlength=\"20\" autocomplete=\"off\"" + (y.err ? " aria-invalid=\"true\" aria-describedby=\"dpmTyEdE\"" : "") + "><button type=\"button\" class=\"btn sm\" data-ty-cancel>取消</button><button type=\"button\" class=\"btn sm primary\" data-ty-save=\"" + i + "\">保存</button></li>" + (y.err ? "<li class=\"wl-err\" id=\"dpmTyEdE\">" + esc(y.err) + "</li>" : "");
					const n = this.typeUse(t);
					return "<li class=\"ty-row\" data-ty=\"" + i + "\"><button type=\"button\" class=\"ib sm ty-grip\" data-tygrip=\"" + i + "\" aria-label=\"调整「" + esc(t) + "」的顺序：按住拖动，或 Alt+上下方向键\">" + ic("grip") + "</button><span class=\"nm\">" + esc(t) + "</span><span class=\"use\">" + (n ? n + " 条链接在用" : "没有链接在用") + "</span><button type=\"button\" class=\"ib sm\" data-ty-edit=\"" + i + "\" aria-label=\"改名 " + esc(t) + "\">" + ic("pencil") + "</button></li>";
				}).join("") + "<li class=\"drop-line\" id=\"dpmTyDrop\" aria-hidden=\"true\" hidden></li>";
				const inp = this.$("#dpmTyNew");
				inp.value = keep;
				inp.classList.toggle("bad", !!y.addErr);
				if (y.addErr) {
					inp.setAttribute("aria-invalid", "true");
					inp.setAttribute("aria-describedby", "dpmTyNewE");
				} else {
					inp.removeAttribute("aria-invalid");
					inp.removeAttribute("aria-describedby");
				}
				const e = this.$("#dpmTyNewE");
				e.textContent = y.addErr;
				e.hidden = !y.addErr;
				if (focus) {
					const f = this.root.querySelector(focus);
					f?.focus();
					if (f && focus === "#dpmTyEd") f.select();
				}
			}
			/** 前端先查一遍（空 / 超长 / 重名），服务端同样校验。 */
			typeErr(v, skip) {
				if (!v) return "类型名不能为空";
				if (v.length > 20) return "类型名不能超过 20 字";
				if (this.linkTypes.some((t, i) => t === v && i !== skip)) return "已经有「" + v + "」了";
				return "";
			}
			async typeAdd() {
				const y = this.ty;
				if (!y) return;
				const inp = this.$("#dpmTyNew");
				const v = inp.value.replace(/\s+/g, " ").trim();
				y.addErr = this.typeErr(v, -1);
				if (y.addErr) {
					this.typesRender("#dpmTyNew");
					return;
				}
				try {
					const r = await post("linktype/add", { name: v });
					if (this.disposed) return;
					this.snap = r;
					inp.value = "";
					this.render();
					this.typesRender("#dpmTyNew");
					this.host.toast("已新增类型「" + r.result + "」，所有卡片都能选");
				} catch (e) {
					y.addErr = e instanceof ApiError ? e.message : String(e);
					this.typesRender("#dpmTyNew");
				}
			}
			async typeSave(i) {
				const y = this.ty;
				const from = this.linkTypes[i];
				if (!y || from === void 0) return;
				const v = (this.$("#dpmTyEd")?.value ?? "").replace(/\s+/g, " ").trim();
				if (v === from) {
					y.edit = -1;
					y.err = "";
					this.typesRender();
					return;
				}
				y.err = this.typeErr(v, i);
				if (y.err) {
					this.typesRender("#dpmTyEd");
					return;
				}
				try {
					const r = await post("linktype/rename", {
						from,
						to: v
					});
					if (this.disposed) return;
					this.snap = r;
					y.edit = -1;
					y.err = "";
					this.render();
					this.typesRender();
					this.root.querySelector("[data-ty-edit=\"" + i + "\"]")?.focus();
					this.host.toast("「" + from + "」已改名为「" + r.result.name + "」" + (r.result.links ? "，" + r.result.links + " 条链接一起更新" : ""));
				} catch (e) {
					y.err = e instanceof ApiError ? e.message : String(e);
					this.typesRender("#dpmTyEd");
				}
			}
			/** 0.14 类型排序：拖把手（指针）或 Alt+↑↓；落点 = 两项之间空隙里的独立指示线。 */
			td = null;
			tdDown(e) {
				const h = e.target.closest?.("[data-tygrip]");
				if (!h || e.button !== 0 || !this.ty || this.ty.edit >= 0) return false;
				e.preventDefault();
				h.setPointerCapture(e.pointerId);
				this.td = {
					i: Number(h.dataset.tygrip),
					y0: e.clientY,
					on: false,
					to: -1
				};
				return true;
			}
			tdMove(e) {
				const td = this.td;
				if (!td) return;
				const rows = Array.from(this.root.querySelectorAll("#dpmTyList [data-ty]"));
				if (!td.on) {
					if (Math.abs(e.clientY - td.y0) < 4) return;
					td.on = true;
					this.root.classList.add("wdragging");
					rows[td.i]?.classList.add("lifting");
				}
				let at = rows.length;
				for (let k = 0; k < rows.length; k++) {
					const r = rows[k].getBoundingClientRect();
					if (e.clientY < r.top + r.height / 2) {
						at = k;
						break;
					}
				}
				const line = this.root.querySelector("#dpmTyDrop");
				if (at === td.i || at === td.i + 1 || !rows.length || !line) {
					td.to = -1;
					if (line) line.hidden = true;
					return;
				}
				td.to = at;
				const gap = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop - rows[0].offsetHeight : 6;
				const y = at < rows.length ? rows[at].offsetTop - gap / 2 : rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight + gap / 2;
				line.style.top = y + "px";
				line.hidden = false;
			}
			tdStop(commit) {
				const td = this.td;
				if (!td) return false;
				this.td = null;
				this.root.classList.remove("wdragging");
				this.root.querySelectorAll("#dpmTyList .lifting").forEach((n) => n.classList.remove("lifting"));
				const line = this.root.querySelector("#dpmTyDrop");
				if (line) line.hidden = true;
				if (commit && td.on && td.to >= 0) this.typeMove(td.i, td.to > td.i ? td.to - 1 : td.to);
				return true;
			}
			async typeMove(i, to) {
				const name = this.linkTypes[i];
				if (name === void 0 || to < 0 || to >= this.linkTypes.length || to === i) return;
				try {
					const r = await post("linktype/move", {
						name,
						to
					});
					if (this.disposed) return;
					this.snap = r;
					this.render();
					this.typesRender();
					const row = this.root.querySelector("#dpmTyList [data-ty=\"" + to + "\"]");
					if (row) {
						row.classList.add("landed");
						setTimeout(() => row.classList.remove("landed"), 450);
					}
					this.root.querySelector("[data-tygrip=\"" + to + "\"]")?.focus({ preventScroll: true });
					this.host.toast("「" + name + "」移到第 " + (to + 1) + " 位");
				} catch (e) {
					this.host.toast("调整顺序失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				}
			}
			async wlSave() {
				const w = this.wl;
				const c = w ? this.card(w.card) : void 0;
				if (!w || !c) return;
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
				if (rows.some((_, i) => !!this.wlDupOf(i))) {
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
				const s = this.root.querySelector("[data-note-save]");
				const n = this.root.querySelector("#dpmNoteN");
				if (s) s.disabled = !dirty;
				const x = this.root.querySelector("[data-note-clear]");
				if (x) x.hidden = v === "";
				if (n) n.textContent = v.length + " 字" + (c.notes ? " · 编辑中" : "");
			}
			/** 相关文件：完整路径 + 存在/已删除 + 解除关联图标（只移出列表，不删文件）。 */
			filesHtml(c, ro = false) {
				const fs = c.files ?? [];
				const st = this.snap?.files ?? {};
				const rows = fs.map((p) => {
					const ok = st[p] !== false;
					return "<div class=\"frow-f" + (ok ? "" : " gone") + "\">" + ic(ok ? "file" : "filex") + "<div class=\"txt\"><div class=\"nm mq\">" + esc(folderName(p)) + "</div><span class=\"mono mq\">" + esc(p) + "</span>" + (ok ? "<span class=\"chip ok\">存在</span>" : "<span class=\"chip warn\">已删除</span>") + "</div>" + (ro ? "" : "<button type=\"button\" class=\"ib sm unl tipbtn\" data-file-unlink=\"" + esc(p) + "\" aria-label=\"解除关联 " + esc(p) + "\">" + ic("unlink") + "<span class=\"tip\" aria-hidden=\"true\">解除关联</span></button>") + "</div>";
				}).join("") || "<p class=\"meta\">" + (ro ? "没有相关文件。" : "还没有相关文件。点「选择文件」从系统里选（可多选），或「粘贴路径」。") + "</p>";
				if (ro) return "<section class=\"sec\"><h3>" + ic("file") + "相关文件 · " + fs.length + "</h3>" + rows + "</section>";
				const fp = this.fp && this.fp.card === c.id ? this.fp : null;
				const paste = fp ? "<div class=\"fp\" id=\"dpmFp\"><label for=\"dpmFpIn\">文件的绝对路径（可一次粘贴多行）</label><textarea id=\"dpmFpIn\" spellcheck=\"false\" autocomplete=\"off\" aria-describedby=\"dpmFpChk\" placeholder=\"~/Desktop/方案.md&#10;/srv/demo/日志.zip\">" + esc(fp.text) + "</textarea><ul class=\"fp-chk\" id=\"dpmFpChk\" aria-live=\"polite\">" + this.fpChkHtml(fp) + "</ul><div class=\"fp-bar\"><span class=\"meta\" id=\"dpmFpSum\">" + this.fpSum(fp) + "</span><span class=\"grow\"></span><button type=\"button\" class=\"btn sm\" data-fp-cancel>取消</button><button type=\"button\" class=\"btn primary sm\" data-fp-ok" + (fp.res.some((r) => r.status === "ok") ? "" : " disabled") + ">" + this.fpOkText(fp) + "</button></div></div>" : "";
				return "<section class=\"sec\"><h3>" + ic("file") + "相关文件 · " + fs.length + "<span class=\"grow\"></span><span class=\"fseg\" role=\"group\" aria-label=\"添加文件的方式\"><button type=\"button\" class=\"btn ghost sm\" data-file-add" + (this.filePicking ? " disabled" : "") + ">" + ic("plus") + (this.filePicking ? "选择中…" : "选择文件") + "</button><button type=\"button\" class=\"btn ghost sm\" data-fp-open aria-expanded=\"" + !!fp + "\" aria-controls=\"dpmFp\">" + ic("clip") + "粘贴路径</button></span></h3>" + rows + paste + "</section>";
			}
			fpChkHtml(fp) {
				return fp.res.map((r) => "<li class=\"" + fpKind(r.status) + "\">" + ic(FP_ICON[r.status]) + "<span class=\"p\">" + esc(r.status === "bad" ? r.raw : r.path) + "</span><span class=\"why\">" + FP_WHY[r.status] + "</span></li>").join("");
			}
			fpSum(fp) {
				if (!fp.res.length) return fp.text.trim() ? "检测中…" : "";
				const n = fp.res.filter((r) => r.status === "ok").length;
				const bad = fp.res.filter((r) => fpKind(r.status) === "bad").length;
				return n + " 个可添加" + (bad ? "，" + bad + " 个有问题" : "");
			}
			fpOkText(fp) {
				const n = fp.res.filter((r) => r.status === "ok").length;
				return n ? "添加 " + n + " 个" : "添加";
			}
			/** 只更新检测结果区（不重绘详情，输入框光标不动）。 */
			fpPaint() {
				const fp = this.fp;
				const box = this.root.querySelector("#dpmFp");
				if (!fp || !box) return;
				this.$("#dpmFpChk").innerHTML = this.fpChkHtml(fp);
				this.$("#dpmFpSum").textContent = this.fpSum(fp);
				const ok = this.$("[data-fp-ok]");
				ok.disabled = !fp.res.some((r) => r.status === "ok");
				ok.textContent = this.fpOkText(fp);
				this.lastDetail = "";
			}
			async fpCheck() {
				const fp = this.fp;
				if (!fp) return;
				const lines = fp.text.split(/\r?\n/).filter((l) => l.trim());
				const seq = ++fp.seq;
				if (!lines.length) {
					fp.res = [];
					this.fpPaint();
					return;
				}
				try {
					const r = await post("card/files-check", {
						id: fp.card,
						paths: lines
					});
					if (this.fp !== fp || fp.seq !== seq) return;
					fp.res = r.results;
				} catch (e) {
					if (this.fp !== fp || fp.seq !== seq) return;
					fp.res = [];
					this.host.toast("检测路径失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				}
				this.fpPaint();
			}
			fpOpen(c, on) {
				this.fp = on ? {
					card: c.id,
					text: "",
					res: [],
					seq: 0
				} : null;
				if (document.activeElement?.id === "dpmFpIn") document.activeElement.blur();
				this.lastDetail = "";
				this.renderDetail();
				if (on) this.root.querySelector("#dpmFpIn")?.focus();
				else this.root.querySelector("[data-fp-open]")?.focus();
			}
			async fpAdd(c) {
				const fp = this.fp;
				if (!fp) return;
				const add = fp.res.filter((r) => r.status === "ok").map((r) => r.path);
				if (!add.length) return;
				const left = fp.res.filter((r) => fpKind(r.status) === "bad").map((r) => r.raw);
				if (!await this.act("card/files-add", {
					id: c.id,
					paths: add
				}, "已添加 " + add.length + " 个相关文件" + (left.length ? "，有问题的 " + left.length + " 行留在输入框里" : "")) || this.fp !== fp) return;
				if (!left.length) return this.fpOpen(c, false);
				fp.text = left.join("\n");
				fp.res = [];
				if (document.activeElement?.id === "dpmFpIn") document.activeElement.blur();
				this.lastDetail = "";
				this.renderDetail();
				this.root.querySelector("#dpmFpIn")?.focus();
				this.fpCheck();
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
					this.render();
					console.warn("[dsh-project-manager] card/files-pick 失败，改为粘贴路径：", e);
					this.host.toast((e instanceof ApiError ? e.message : String(e)) + "。可以直接粘贴文件的绝对路径", "err");
					this.fpOpen(c, true);
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
					if (!this.tdDown(e) && !this.wdDown(e)) this.gdDown(e);
				});
				this.on(r, "pointermove", (e) => {
					if (this.td) this.tdMove(e);
					else if (this.wd) this.wdMove(e);
					else this.gdMove(e);
				});
				this.on(r, "pointerup", () => {
					if (!this.tdStop(true) && !this.wdStop(true)) this.gdStop(true);
				});
				this.on(r, "pointercancel", () => {
					if (!this.tdStop(false) && !this.wdStop(false)) this.gdStop(false);
				});
				this.on(r, "lostpointercapture", () => {
					if (!this.tdStop(false) && !this.wdStop(false)) this.gdStop(false);
				});
				this.on(r, "paste", (e) => this.onPaste(e));
				this.on(this.$("#dpmArList"), "scroll", () => {
					if (!this.arStickRaf) this.arStickRaf = requestAnimationFrame(() => {
						this.arStickRaf = 0;
						this.arStick();
					});
				});
				for (const id of [
					"dpmDlgSt",
					"dpmDlgName",
					"dpmDlgLink",
					"dpmDlgImp",
					"dpmDlgRepo",
					"dpmDlgSess",
					"dpmDlgCfm",
					"dpmDlgSArc",
					"dpmDlgWl",
					"dpmDlgTy"
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
				if (d.more === "sess" || d.more === "mem") {
					const k = d.more;
					this.more[k] = !this.more[k];
					this.renderDetail();
					const b = this.root.querySelector("[data-more=\"" + k + "\"]");
					if (b) {
						b.focus({ preventScroll: true });
						if (!this.more[k]) b.closest(".sec")?.scrollIntoView({ block: "nearest" });
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
				if (d.types !== void 0) return this.typesOpen();
				if (d.tyEdit !== void 0 && this.ty) {
					this.ty.edit = Number(d.tyEdit);
					this.ty.err = "";
					this.typesRender("#dpmTyEd");
					return;
				}
				if (d.tyCancel !== void 0 && this.ty) {
					const i = this.ty.edit;
					this.ty.edit = -1;
					this.ty.err = "";
					this.typesRender();
					this.root.querySelector("[data-ty-edit=\"" + i + "\"]")?.focus();
					return;
				}
				if (d.tySave !== void 0) return this.typeSave(Number(d.tySave));
				if (d.tyAdd !== void 0) return this.typeAdd();
				if (d.delSess) {
					const v = this.sessIndex().get(d.delSess);
					if (v) await this.host.deleteSession(v.id, v.title);
					return;
				}
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
				if (t.id === "dpmWlOk") return this.wlSave();
				if (d.wlDupEdit !== void 0 && this.wl) {
					const c = this.card(this.wl.card);
					if (!c) return;
					this.wlOpen(c, "edit", Number(d.wlDupEdit));
					this.$("#dpmWlP").textContent = "这是之前已添加的那条链接，改完点保存。";
					this.root.querySelector("#dpmWx0")?.focus();
					return;
				}
				if (d.wlDupBack !== void 0) {
					const i = this.root.querySelector("#dpmWu" + d.wlDupBack);
					i?.focus();
					i?.select();
					return;
				}
				if (d.copyUrl !== void 0) {
					const url = d.copyUrl;
					try {
						await navigator.clipboard.writeText(url);
					} catch (e) {
						this.host.toast("复制失败：" + (e instanceof Error ? e.message : String(e)), "err");
						return;
					}
					t.classList.add("copied");
					setTimeout(() => t.classList.remove("copied"), 1200);
					this.host.toast("已复制链接：" + url);
					return;
				}
				if (d.card) {
					if (this.sel !== d.card) {
						this.noteEdit = null;
						this.fp = null;
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
					this.fp = null;
					return this.render();
				}
				if (d.themeToggle !== void 0) {
					this.host.setDark(!this.host.isDark());
					return;
				}
				if (d.toggle) return this.toggleGroup(d.toggle);
				if (d.gdrag) return;
				if (d.newIn) return this.host.pickCard(t, d.newIn);
				if (d.openCard !== void 0 && c) {
					if (this.creating) return;
					return this.host.newSession(c.id);
				}
				if (d.lfRecall !== void 0 && c) return this.lfSend(c, "回忆");
				if (d.lfPersist !== void 0 && c) return this.lfSend(c, "落盘项目");
				if (d.lfUpgrade !== void 0) {
					if (this.upgrading || !window.confirm("升级 ~/.ai/tools/ai-memory？\n\n会先把现有的备份到插件数据目录，再换成插件自带的新版（只新增 import / version 命令）。")) return;
					this.upgrading = true;
					this.render();
					try {
						await this.act("landfill/upgrade-tool", {}, "已升级 ai-memory（原文件已备份）");
					} finally {
						this.upgrading = false;
						this.render();
					}
					return;
				}
				if (d.lfAdopt !== void 0) {
					if (this.adopting || !window.confirm("接管 landfill-project skill？\n\n会先把现有的 SKILL.md 备份到插件数据目录，再换成指向插件里那份的链接。之后 Codex 等工具读到的也是插件这份。")) return;
					this.adopting = true;
					this.render();
					try {
						await this.act("landfill/adopt-skill", {}, "已接管 skill（原文件已备份）");
					} finally {
						this.adopting = false;
						this.render();
					}
					return;
				}
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
				if (d.noteClear !== void 0 && c) {
					const i = this.root.querySelector("#dpmNoteIn");
					if (!i) return;
					i.focus();
					i.select();
					if (!document.execCommand("delete")) i.value = "";
					this.noteEdit = {
						card: c.id,
						draft: ""
					};
					this.syncNoteBar(c, "");
					i.focus();
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
				if (d.fpOpen !== void 0 && c) return this.fpOpen(c, !(this.fp && this.fp.card === c.id));
				if (d.fpCancel !== void 0 && c) return this.fpOpen(c, false);
				if (d.fpOk !== void 0 && c) return this.fpAdd(c);
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
					}, "已从卡片共用仓库移除「" + r.name + "」。已有卡片里的这个仓库不受影响")) this.renderGroupSettings();
					return;
				}
				if (t.id === "dpmArPick") return this.pickFolder();
				if (t.id === "dpmArManualAdd") return this.addManualPath();
				if (d.ardel !== void 0 && this.ar) {
					this.ar.sel.splice(Number(d.ardel), 1);
					this.renderSel();
					return;
				}
				if (d.arAll !== void 0) return this.arAddAllShared();
				if (d.arJump) return this.arJump(d.arJump);
				if (d.cardRepoAdd !== void 0) return this.openAddRepo("card");
				if (d.cardRepoDel !== void 0) {
					const c = this.sel ? this.card(this.sel) : void 0;
					const r = c?.repos?.[Number(d.cardRepoDel)];
					if (!c || !r) return;
					const rest = (c.repos ?? []).filter((_, k) => k !== Number(d.cardRepoDel));
					await this.act("card/repos", {
						id: c.id,
						repos: rest
					}, "已从这张卡片移除「" + r.name + "」。卡片组的共用仓库和其他卡片不受影响");
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
				if (t.id === "dpmFpIn" && this.fp) {
					this.fp.text = t.value;
					clearTimeout(this.fpTimer);
					this.fpTimer = window.setTimeout(() => void this.fpCheck(), 250);
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
				if (t.id === "dpmTyNew" && this.ty?.addErr) {
					this.ty.addErr = "";
					t.classList.remove("bad");
					t.removeAttribute("aria-invalid");
					this.$("#dpmTyNewE").hidden = true;
					return;
				}
				if (this.wl && t.closest("#dpmDlgWl")) {
					const w = this.wl;
					const d = t.dataset;
					if (d.wtext !== void 0) w.rows[Number(d.wtext)].text = t.value;
					if (d.wurl !== void 0) {
						const r = w.rows[Number(d.wurl)];
						r.url = t.value;
						if (r.err) {
							r.err = "";
							t.classList.remove("bad");
							t.removeAttribute("aria-invalid");
							t.parentElement?.querySelector(":scope > .wl-err")?.remove();
						}
						this.wlDupAll();
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
					this.$("#dpmArList").scrollTop = 0;
					this.arPaintList();
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
					const p = t.dataset.ar;
					if (t.checked) {
						if (!this.arAdd(p)) t.checked = false;
					} else this.ar.sel = this.ar.sel.filter((x) => x.path !== p);
					this.renderSel(t.checked ? [p] : void 0);
					return;
				}
				if ((t.dataset.rpname !== void 0 || t.dataset.rprole !== void 0) && this.editG) return this.saveRepoField(t);
				if (t.id === "dpmGroupLf" && this.editG) {
					const v = t.value.trim().toLowerCase();
					const g = this.grp(this.editG);
					if (g && v !== (g.lfProject ?? "")) {
						if (await this.act("group/update", {
							id: this.editG,
							lfProject: v
						}, v ? "落盘文件夹：~/.ai/projects/" + v + "/（第一次落盘时登记到 ~/.ai）" : "已清除落盘文件夹")) this.renderGroupSettings();
						else t.value = g.lfProject ?? "";
					}
					return;
				}
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
				if (t.id === "dpmFpIn" && !e.isComposing) {
					const c = this.sel ? this.card(this.sel) : void 0;
					if (c && e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						this.fpOpen(c, false);
						return;
					}
					if (c && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						clearTimeout(this.fpTimer);
						await this.fpCheck();
						await this.fpAdd(c);
						return;
					}
				}
				if (this.td && e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					this.tdStop(false);
					return;
				}
				if (this.ty && t.dataset?.tygrip !== void 0 && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
					e.preventDefault();
					const i = Number(t.dataset.tygrip);
					await this.typeMove(i, i + (e.key === "ArrowUp" ? -1 : 1));
					return;
				}
				if (this.ty && t.closest("#dpmDlgTy")) {
					if (e.isComposing) return;
					if (t.id === "dpmTyNew" && e.key === "Enter") {
						e.preventDefault();
						await this.typeAdd();
						return;
					}
					if (t.id === "dpmTyEd" && e.key === "Enter") {
						e.preventDefault();
						await this.typeSave(this.ty.edit);
						return;
					}
					if (t.id === "dpmTyEd" && e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						const i = this.ty.edit;
						this.ty.edit = -1;
						this.ty.err = "";
						this.typesRender();
						this.root.querySelector("[data-ty-edit=\"" + i + "\"]")?.focus();
						return;
					}
					return;
				}
				if (this.wl && t.closest("#dpmDlgWl")) {
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
				if (id === "dpmDlgTy") {
					this.ty = null;
					this.root.querySelector(".detail [data-types]")?.focus({ preventScroll: true });
				}
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
				this.$("#dpmStList").innerHTML = "<label class=\"lbl\" for=\"dpmGroupName\">组名</label><input class=\"fld\" id=\"dpmGroupName\" value=\"" + esc(g.name) + "\"><label class=\"lbl\" for=\"dpmGroupLf\">落盘文件夹</label><div class=\"lf-fld\"><span class=\"pre\">~/.ai/projects/</span><input id=\"dpmGroupLf\" value=\"" + esc(g.lfProject ?? "") + "\" placeholder=\"还没设（第一次在这个组落盘时会请你确认）\" spellcheck=\"false\" autocomplete=\"off\" maxlength=\"64\"><span class=\"pre\">/</span></div><p class=\"meta mb\">这个组新建、合并、迁移的落盘项目都放进这里；旧的落盘项目在下次落盘时自动迁过来（可在会话信息卡撤销）。改名不会搬已有文件。失焦即保存。</p><div class=\"lbl row\" id=\"dpmStLinks\">关联的落盘项目 · " + g.links.length + "<span class=\"grow\"></span><button type=\"button\" class=\"btn ghost sm\" data-link-group=\"" + esc(g.id) + "\">" + ic("plus") + "关联</button></div>" + gl + "<div class=\"lbl row\">卡片共用仓库 · " + g.repos.length + "<span class=\"grow\"></span><button type=\"button\" class=\"btn ghost sm\" id=\"dpmRepoAdd\">" + ic("plus") + "添加卡片共用仓库</button></div><p class=\"meta mb\">在这个组里新建卡片时，会自动带上这些仓库。这里的改动只影响之后新建的卡片，组里已有的 " + this.cardsOf(g.id) + " 张卡片不变。</p>" + (repos ? repos + "<p class=\"meta\">名称、角色改完离开输入框即保存；要换路径就移除后重新添加。</p>" : "<p class=\"ar-empty\">还没有卡片共用仓库。新建的卡片不会自动带仓库，可以在卡片详情里单独新增。</p>") + "<div class=\"lbl\">阶段（点序号上移）</div>" + sts + "<button type=\"button\" class=\"btn ghost sm\" id=\"dpmStAdd\">" + ic("plus") + "添加阶段</button><p class=\"meta\">阶段下还有卡片时不能删除，先把卡片移走。</p>";
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
				const all = this.moreOf(c).sess;
				if (!refs.length) return "<p class=\"meta\">" + (ro ? "没有会话。" : "还没有会话。可以「以此卡片新建会话」，或关联已有会话。") + "</p>";
				const idx = this.sessIndex();
				const canRestore = this.snap?.caps?.unarchive !== false;
				return "<div id=\"dpmSessList\">" + limitList(sortLinked(refs, idx), all).map((r) => {
					const v = idx.get(r.sessionId);
					const title = v?.title ?? r.title ?? "会话 " + r.sessionId.slice(0, 8);
					const unl = ro ? "" : "<button type=\"button\" class=\"ib sm unl tipbtn\" data-unbind=\"" + esc(r.sessionId) + "\" aria-label=\"解除关联 " + esc(title) + "\">" + ic("unlink") + "<span class=\"tip\" aria-hidden=\"true\">解除关联</span></button>";
					if (!v) return "<div class=\"lsess gone\"><div class=\"l1\"><span class=\"lname\">会话已删除</span>" + unl + "</div><div class=\"l2\"><span class=\"sub2\">原名「" + esc(title) + "」</span></div></div>";
					const name = v.archived ? "<span class=\"lname\" title=\"已归档的会话不能打开，先「恢复活跃」\">" + esc(title) + "</span>" : "<button type=\"button\" class=\"lname\" data-open-sess=\"" + esc(v.id) + "\" title=\"打开会话：" + esc(title) + "\">" + esc(title) + "</button>";
					const sdel = !ro && !v.archived && v.blank && this.host.canDeleteSession() ? "<button type=\"button\" class=\"ib sm sdel tipbtn\" data-del-sess=\"" + esc(v.id) + "\" aria-label=\"删除 " + esc(title) + "\">" + ic("trash") + "<span class=\"tip\" aria-hidden=\"true\">删除（还没有对话）</span></button>" : "";
					const sarc = ro || v.archived ? "" : "<button type=\"button\" class=\"ib sm sarc tipbtn\" data-archive-sess=\"" + esc(v.id) + "\" aria-label=\"归档会话 " + esc(title) + "\">" + ic("archive") + "<span class=\"tip\" aria-hidden=\"true\">归档会话</span></button>";
					const restore = v.archived && !ro ? "<button type=\"button\" class=\"btn ghost xs\" data-restore=\"" + esc(v.id) + "\"" + (canRestore && !this.restoring.has(v.id) ? "" : " disabled") + " title=\"" + (canRestore ? "恢复到工作区原来的位置" : "当前 DSH 没有恢复归档的能力（需要 dsh-manage-sessions）") + "\">" + ic("restore") + (this.restoring.has(v.id) ? "恢复中…" : "恢复活跃") + "</button>" : "";
					return "<div class=\"lsess" + (v.archived ? " archived" : "") + "\"><div class=\"l1\">" + name + "<span class=\"acts\">" + sdel + sarc + unl + "</span></div><div class=\"l2\">" + (v.archived ? "<span class=\"chip arch\">已归档</span>" : v.blank ? "<span class=\"chip\">未开始</span>" : "<span class=\"chip live\">活跃</span>") + "<span class=\"sub2\">" + (v.forkOf ? "分叉自「" + esc(v.forkOf) + "」 · " : "") + esc(v.ws) + " · " + esc(ago(v.updatedAt)) + "</span>" + restore + "</div></div>";
				}).join("") + "</div>" + moreBtn("sess", all, refs.length, "dpmSessList");
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
			openAddRepo(mode = "group") {
				if (mode === "group") {
					const g = this.grp(this.editG ?? "");
					if (!g) return;
					this.ar = {
						mode,
						id: g.id,
						q: "",
						sel: [],
						manual: false,
						busy: false
					};
					this.$("#dpmArT").textContent = "添加卡片共用仓库";
					this.$("#dpmArP").textContent = "之后在「" + g.name + "」里新建的卡片会自动带上这些仓库，已有的卡片不变。可以多选。";
				} else {
					const c = this.sel ? this.card(this.sel) : void 0;
					if (!c || c.archivedAt) return;
					this.ar = {
						mode,
						id: c.id,
						q: "",
						sel: [],
						manual: false,
						busy: false
					};
					this.$("#dpmArT").textContent = "新增仓库";
					this.$("#dpmArP").textContent = "只加到卡片「" + c.t + "」，不影响卡片组和其他卡片。可以多选。";
				}
				this.$("#dpmArQ").value = "";
				const d = this.$("#dpmDlgRepo");
				d.returnValue = "";
				d.showModal();
				this.$("#dpmArList").scrollTop = 0;
				this.$("#dpmArSel").scrollTop = 0;
				this.renderAddRepo();
				this.$("#dpmArQ").focus();
			}
			/** 弹窗目标当前的仓库清单。 */
			arRepos() {
				const a = this.ar;
				if (!a) return [];
				return a.mode === "group" ? this.grp(a.id)?.repos ?? [] : this.card(a.id)?.repos ?? [];
			}
			arMounted(path) {
				return this.arRepos().some((r) => normPath(r.path) === normPath(path));
			}
			arWho() {
				return this.ar?.mode === "card" ? "这张卡片" : "本组的卡片共用仓库";
			}
			arAdd(path) {
				const a = this.ar;
				if (!a) return false;
				if (this.arMounted(path)) {
					this.host.toast("「" + folderName(path) + "」已在" + this.arWho() + "里", "err");
					return false;
				}
				if (a.sel.some((x) => normPath(x.path) === normPath(path))) {
					this.host.toast("「" + folderName(path) + "」已在「已选」里", "err");
					return false;
				}
				const h = (this.snap?.board.repoHistory ?? []).find((x) => normPath(x.path) === normPath(path));
				a.sel.push({
					path,
					name: h?.name ?? folderName(path),
					role: h?.role ?? "仓库"
				});
				return true;
			}
			arErrs() {
				const a = this.ar;
				if (!a) return [];
				const cur = this.arRepos();
				return a.sel.map((x, i) => {
					const n = x.name.replace(/\s+/g, " ").trim();
					if (!n) return "名称不能为空";
					if (n.length > 120) return "名称超过 120 字";
					if (cur.some((r) => r.name === n)) return (a.mode === "card" ? "这张卡片" : "卡片共用仓库里") + "已有同名仓库「" + n + "」";
					if (a.sel.slice(0, i).some((o) => o.name.replace(/\s+/g, " ").trim() === n)) return "和上面的仓库重名，改一个名字";
					return "";
				});
			}
			arPk(r) {
				const a = this.ar;
				if (!a) return "";
				const m = this.arMounted(r.path);
				const on = m || a.sel.some((x) => normPath(x.path) === normPath(r.path));
				const tail = m ? "<span class=\"chip plain\">已添加</span>" : r.at ? "<span class=\"when\">" + esc(addedAgo(r.at)) + "</span>" : "";
				return "<label class=\"pk" + (m ? " lock" : "") + "\"><input type=\"checkbox\" data-ar=\"" + esc(r.path) + "\"" + (on ? " checked" : "") + (m ? " disabled" : "") + "><span class=\"txt\"><span class=\"nm\">" + esc(r.name) + "</span><span class=\"mono\" title=\"" + esc(r.path) + "\">" + esc(r.path) + "</span></span>" + tail + "</label>";
			}
			/** 0.14 候选仓库 = 任意卡片组 / 卡片添加过的仓库（移除了也在），最近添加的在前；卡片模式把本组共用仓库单列一组。
			*  0.15：每组一个 .ar-grp，组标题 sticky 吸顶（下一组标题把上一组顶走）；候选标题行的分组切换跟随滚动高亮。 */
			arListHtml() {
				const a = this.ar;
				if (!a) return "";
				const hist = (this.snap?.board.repoHistory ?? []).slice().sort((x, y) => x.at < y.at ? 1 : x.at > y.at ? -1 : 0);
				const hit = (r) => !a.q || (r.name + " " + r.path).toLowerCase().includes(a.q);
				const block = (all, none, miss) => all.length ? all.filter(hit).length ? "<div class=\"pk-list ar-list\">" + all.filter(hit).map((r) => this.arPk(r)).join("") + "</div>" : "<p class=\"ar-empty\">" + miss + "</p>" : "<p class=\"ar-empty\">" + none + "</p>";
				const head = (id, title, n, extra) => "<div class=\"ar-sub\" id=\"" + id + "H\"><button type=\"button\" class=\"ar-jump\" data-ar-jump=\"" + id + "\" aria-label=\"回到「" + title + "」开头\">" + title + " · " + n + "<svg class=\"i chev\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m6 9 6 6 6-6\"/></svg></button>" + extra + "</div>";
				if (a.mode === "group") {
					this.arSpy = [];
					this.arTotal = hist.length;
					return "<section class=\"ar-grp\" id=\"dpmArG0\" aria-labelledby=\"dpmArG0H\">" + head("dpmArG0", "任意卡片组、卡片添加过的仓库", hist.filter(hit).length, "<span class=\"grow\"></span><span class=\"meta tail\">最近添加的在前</span>") + block(hist, "还没有添加过任何仓库。点「选择文件夹…」选一个。", "没有匹配的候选仓库") + "</section>";
				}
				const c = this.card(a.id);
				const g = c ? this.grp(c.g) : void 0;
				if (!c || !g) return "";
				const shared = g.repos.map((r) => ({
					...r,
					at: hist.find((h) => normPath(h.path) === normPath(r.path))?.at
				}));
				const others = hist.filter((h) => !g.repos.some((r) => normPath(r.path) === normPath(h.path)));
				const ns = shared.filter(hit).length;
				const no = others.filter(hit).length;
				this.arTotal = shared.length + others.length;
				this.arSpy = [{
					id: "dpmArG1",
					label: "本组共用 · " + ns,
					n: ns
				}, {
					id: "dpmArG2",
					label: "其他 · " + no,
					n: no
				}];
				return "<section class=\"ar-grp\" id=\"dpmArG1\" aria-labelledby=\"dpmArG1H\">" + head("dpmArG1", "本组共用仓库", ns, "<span class=\"meta tail\">卡片组「" + esc(g.name) + "」</span><span class=\"grow\"></span>" + (shared.length ? "<button type=\"button\" class=\"btn ghost sm\" data-ar-all>" + ic("plus") + "<span data-ar-all-t></span></button>" : "")) + block(shared, "卡片组「" + esc(g.name) + "」还没有设置卡片共用仓库。", "没有匹配的本组共用仓库") + "</section><section class=\"ar-grp\" id=\"dpmArG2\" aria-labelledby=\"dpmArG2H\">" + head("dpmArG2", "其他候选仓库", no, "<span class=\"grow\"></span><span class=\"meta tail\">最近添加的在前</span>") + block(others, "没有其他候选仓库。", "没有匹配的候选仓库") + "</section>";
			}
			/** 分组切换（只在卡片模式、有两组时出现）；arTotal = 候选总数（标题旁显示）。 */
			arSpy = [];
			arTotal = 0;
			/** 候选列表整块重画（打开 / 搜索 / 保存后才调；勾选不调，滚动位置不动）。 */
			arPaintList() {
				this.$("#dpmArList").innerHTML = this.arListHtml();
				this.$("#dpmArCandN").textContent = "· " + this.arTotal;
				const spy = this.$("#dpmArSpy");
				spy.innerHTML = this.arSpy.map((s) => "<button type=\"button\" data-ar-jump=\"" + s.id + "\"" + (s.n ? "" : " disabled") + ">" + s.label + "</button>").join("");
				spy.hidden = !this.arSpy.length;
				this.arSyncChecks();
				this.arStick();
			}
			/** 只同步勾选状态与「全部加入已选」按钮（不重画列表）。 */
			arSyncChecks() {
				const a = this.ar;
				if (!a) return;
				this.root.querySelectorAll("#dpmArList input[data-ar]:not([disabled])").forEach((i) => {
					i.checked = a.sel.some((x) => normPath(x.path) === normPath(i.dataset.ar));
				});
				const b = this.root.querySelector("[data-ar-all]");
				if (b) {
					const n = this.arAddable().length;
					b.disabled = !n;
					b.querySelector("[data-ar-all-t]").textContent = n ? "全部加入已选（" + n + "）" : "都已选上";
				}
			}
			/** 本组共用仓库里还能加入「已选」的（没挂、没选）。 */
			arAddable() {
				const a = this.ar;
				const g = a?.mode === "card" ? this.grp(this.card(a.id)?.g ?? "") : void 0;
				if (!a || !g) return [];
				return g.repos.filter((r) => !this.arMounted(r.path) && !a.sel.some((x) => normPath(x.path) === normPath(r.path)));
			}
			/** 吸顶状态 + 分组切换高亮（滚动事件 rAF 合并后调）。 */
			arStickRaf = 0;
			arStick() {
				const box = this.root.querySelector("#dpmArList");
				if (!box) return;
				const top = box.getBoundingClientRect().top;
				const gs = Array.from(box.querySelectorAll(".ar-grp"));
				for (const g of gs) {
					const h = g.querySelector(".ar-sub");
					const r = g.getBoundingClientRect(), hr = h.getBoundingClientRect();
					h.classList.toggle("stuck", box.scrollTop > 0 && Math.abs(hr.top - top) < 1 && r.bottom > hr.bottom + 1);
				}
				let on = gs[0];
				for (const g of gs) if (g.getBoundingClientRect().top <= top + 1) on = g;
				if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) on = gs[gs.length - 1];
				this.root.querySelectorAll("#dpmArSpy [data-ar-jump]").forEach((b) => b.setAttribute("aria-current", String(!!on && b.dataset.arJump === on.id)));
			}
			/** 跳到分组开头（平滑；尊重减少动态效果），首行闪一下、焦点给首个可勾选项。 */
			arJump(id) {
				const box = this.$("#dpmArList");
				const g = this.root.querySelector("#" + id);
				if (!g) return;
				const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
				box.scrollTo({
					top: g.offsetTop - box.firstElementChild.offsetTop,
					behavior: reduce ? "auto" : "smooth"
				});
				const first = g.querySelector(".pk:not(.lock)") ?? g.querySelector(".pk");
				if (first) {
					first.classList.remove("flash");
					first.offsetWidth;
					first.classList.add("flash");
					first.querySelector("input:not([disabled])")?.focus({ preventScroll: true });
				}
			}
			arSelHtml() {
				const a = this.ar;
				if (!a) return "";
				return a.sel.map((x, i) => "<div class=\"rp-row\" data-path=\"" + esc(x.path) + "\"><input class=\"fld\" data-arname=\"" + i + "\" aria-label=\"仓库名 " + (i + 1) + "\" aria-describedby=\"dpmArE" + i + "\" maxlength=\"120\" value=\"" + esc(x.name) + "\"><input class=\"fld\" data-arrole=\"" + i + "\" aria-label=\"仓库角色 " + (i + 1) + "\" maxlength=\"40\" value=\"" + esc(x.role) + "\"><span class=\"mono\" title=\"" + esc(x.path) + "\">" + esc(x.path) + "</span><button type=\"button\" class=\"ib\" data-ardel=\"" + i + "\" aria-label=\"从已选移除 " + esc(x.name || x.path) + "\">" + ic("x") + "</button><p class=\"rp-err\" id=\"dpmArE" + i + "\" hidden></p></div>").join("") || "<p class=\"ar-empty\">还没有选择仓库。勾选上面的候选仓库，或点「选择文件夹…」。</p>";
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
				this.$("#dpmArCount").textContent = a.sel.length ? "将添加 " + a.sel.length + " 个仓库" : "";
				this.$("#dpmArOk").disabled = a.busy || !a.sel.length || errs.some(Boolean);
			}
			/** 整个弹窗重画（打开 / 保存失败重开）；勾选与「已选」增删只走 renderSel。 */
			renderAddRepo() {
				if (!this.ar) return;
				this.arPaintList();
				this.renderSel();
			}
			/** 0.15：只重画「已选」+ 同步候选勾选（候选列表不重画 → 滚动位置不动）。fresh = 新加入的路径（滚到可见、闪一下）。 */
			renderSel(fresh) {
				const a = this.ar;
				if (!a) return;
				this.$("#dpmArSel").innerHTML = this.arSelHtml();
				this.arSyncChecks();
				if (fresh?.length) {
					const rows = Array.from(this.root.querySelectorAll("#dpmArSel .rp-row")).filter((r) => fresh.some((p) => normPath(p) === normPath(r.dataset.path ?? "")));
					rows.forEach((r) => r.classList.add("fresh"));
					rows[rows.length - 1]?.scrollIntoView({ block: "nearest" });
				}
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
					this.renderSel([path]);
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
					this.renderSel([v]);
					this.focusLastSel();
				}
			}
			/** 0.15「全部加入已选」：只把本组共用仓库（没挂、没选的）放进「已选」，用户还能取消勾选 / 改名，点保存才写入。 */
			arAddAllShared() {
				const a = this.ar;
				if (!a || a.busy) return;
				const add = this.arAddable();
				if (!add.length) return;
				for (const r of add) {
					const h = (this.snap?.board.repoHistory ?? []).find((x) => normPath(x.path) === normPath(r.path));
					a.sel.push({
						path: r.path,
						name: r.name || h?.name || folderName(r.path),
						role: r.role || h?.role || "仓库"
					});
				}
				this.renderSel(add.map((r) => r.path));
				this.host.toast("已把 " + add.length + " 个本组共用仓库放进「已选」，确认后点保存");
			}
			async saveAddRepo(a) {
				const repos = a.sel.map((x) => ({
					name: x.name.replace(/\s+/g, " ").trim(),
					role: x.role.trim() || "仓库",
					path: x.path
				}));
				const n = a.mode === "group" ? this.cardsOf(a.id) : 0;
				if (!(a.mode === "group" ? await this.act("group/repos-add", {
					id: a.id,
					repos
				}, "已添加 " + repos.length + " 个卡片共用仓库。组里已有的 " + n + " 张卡片不变，之后新建的卡片会自动带上") : await this.act("card/repos-add", {
					id: a.id,
					repos
				}, "已给这张卡片添加 " + repos.length + " 个仓库，卡片组和其他卡片不变"))) {
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
				if (a.mode === "group") {
					if (this.$("#dpmDlgSt").open) this.renderGroupSettings();
					this.root.querySelector("#dpmRepoAdd")?.focus();
				} else this.root.querySelector(".detail [data-card-repo-add]")?.focus();
			}
			cardsOf(gId) {
				return this.cards.filter((c) => c.g === gId).length;
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
<dialog class="dpm-dialog wide ar-dlg" id="dpmDlgRepo" aria-labelledby="dpmArT"><form method="dialog">
  <div class="ar-head">
    <h2 id="dpmArT">添加挂载仓库</h2><p id="dpmArP"></p>
    <div class="ar-top"><label class="sr-only" for="dpmArQ">搜索候选仓库</label><input class="fld" id="dpmArQ" placeholder="搜索候选仓库（名称或路径）" autocomplete="off"><button type="button" class="btn" id="dpmArPick">%FOLDER%选择文件夹…</button></div>
    <div class="ar-manual" id="dpmArManual" hidden><label class="sr-only" for="dpmArPath">仓库文件夹的绝对路径</label><input class="fld" id="dpmArPath" placeholder="输入文件夹绝对路径，例如 ~/code/repo 展开后的完整路径" autocomplete="off"><button type="button" class="btn" id="dpmArManualAdd">添加</button></div>
  </div>
  <section class="ar-cand" aria-labelledby="dpmArCandH">
    <div class="ar-h"><span id="dpmArCandH">候选仓库</span><span class="meta" id="dpmArCandN"></span><span class="grow"></span><nav class="ar-spy" id="dpmArSpy" aria-label="跳到分组"></nav></div>
    <div class="ar-scroll" id="dpmArList"></div>
  </section>
  <section class="ar-picked" aria-labelledby="dpmArSelH">
    <div class="ar-h"><span id="dpmArSelH">已选 · <span id="dpmArSelN">0</span></span><span class="grow"></span><span class="meta">默认名称是文件夹名，可以改</span></div>
    <div class="ar-scroll" id="dpmArSel"></div>
    <div class="dlg-f"><span class="meta" id="dpmArCount"></span><span class="sp"></span><button class="btn" type="button" data-dlg-cancel>取消</button><button class="btn primary" id="dpmArOk" type="submit" value="ok" disabled>保存</button></div>
  </section>
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
<dialog class="dpm-dialog" id="dpmDlgTy" aria-labelledby="dpmTyT"><form method="dialog">
  <div class="dlg-h"><h2 id="dpmTyT">管理类型</h2><p>所有卡片的「相关链接」共用这些类型。拖动左侧把手调整顺序，添加 / 编辑链接时的类型下拉按这个顺序显示；改名后，用这个类型的链接会一起改过来。</p></div>
  <div class="dlg-b"><ul class="ty-list" id="dpmTyList" aria-label="已有类型"></ul>
    <div class="ty-add"><label class="sr-only" for="dpmTyNew">新类型名称</label><input class="fld" id="dpmTyNew" placeholder="新类型名称，比如「设计稿」" maxlength="20" autocomplete="off"><button type="button" class="btn" data-ty-add>%PLUS%新增</button></div>
    <p class="wl-err" id="dpmTyNewE" hidden></p></div>
  <div class="dlg-f"><span class="sp"></span><button class="btn" type="submit" value="">完成</button></div>
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
		*  - 0.11 reveal：从看板进入会话时，会话所在的卡片组（及「项目区」）收起着就替用户点开；
		*  - 0.12 空会话：宿主只显示「当前打开的那个」还没对话的会话（sessionVisible），其余隐藏；
		*    在「项目区」及其卡片组展开时，把这些会话补画成插件自己的行（排在最前，标「未开始」，点击打开）；
		*  - 0.13 补画行悬停出现删除按钮（数据层面删除，能力来自 dsh-manage-sessions，没有就不出现）。
		* 依据：dsh-client-ui-workspace 行 [data-row-key="workspace:<工作区 id>"]（role=treeitem，aria-expanded），
		* 整组包在 [class*="groupSection"]（行内 style 带 --dsh-workspace-indent），会话行 [data-row-key="session:<id>"]。
		* 失效时（DSH 改版找不到行）：「+」照常新建会话、数字与层级不出现、不自动展开——功能不丢。
		*/
		const ROW = "[data-row-key^=\"workspace:\"]";
		const SEC = "[class*=\"groupSection\"]";
		const wsRow = (id) => "[data-row-key=\"workspace:" + CSS.escape(id) + "\"]";
		const TRASH = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3\"/></svg>";
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		/**
		* 0.12：wids 里每个工作区还没对话的会话：blank、没归档、不是子代理。宿主只画当前打开的那个、而且只写「新会话」，
		* 0.20 起当前那个也由插件画（标 current），标题用会话标题，没有就用看板上记的标题（titles，绑定卡片时就有）。
		* 纯函数（单测直接取源码跑），工作区内顺序保持宿主 sessionIds 的顺序。
		*/
		function blankRows(items, byId, archived, wids, titles = {}) {
			const out = {};
			for (const wid of wids) {
				const w = items.find((x) => x.workspaceId === wid);
				const rows = [];
				for (const id of w && w.sessionIds || []) {
					const s = byId[id];
					if (!s || !s.blank || archived.has(id) || s.origin === "subagent") continue;
					const cur = (s.retainedBy && s.retainedBy.mainView || 0) > 0;
					rows.push(cur ? {
						id,
						title: s.title || titles[id] || "新会话",
						current: true
					} : {
						id,
						title: s.title || titles[id] || "新会话"
					});
				}
				if (rows.length) out[wid] = rows;
			}
			return out;
		}
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
			let css = any(rows, "::after") + " { order: 1; flex: none; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--dpm-cnt-bg); color: var(--dpm-cnt-ink); font-size: 12px; font-weight: 700; line-height: 20px; text-align: center; font-variant-numeric: tabular-nums; }\n" + any(rows, " > [class*=\"rowActions\"]") + " { order: 2; }\n" + any(rows, "[aria-expanded=\"true\"] [class*=\"_title\"]") + " { font-weight: 600; }\n" + any(sec, " > * > :is([data-row-key^=\"session:\"], [data-dpm-blank])") + " { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); padding-inline-start: 8px; }\n" + any(sec, " > *:has(> :is([data-row-key^=\"session:\"], [data-dpm-blank]))") + " { background: linear-gradient(var(--dpm-guide), var(--dpm-guide)) no-repeat calc(15.5px + var(--dsh-workspace-indent, 0px)) 0 / 1px 100%; }\n" + any(sec, " > [class*=\"sessionOverflow\"]") + " { margin-inline-start: calc(24px + var(--dsh-workspace-indent, 0px)); width: calc(100% - 24px - var(--dsh-workspace-indent, 0px)); padding-inline-start: 30px; }\n";
			for (const id of ids) {
				const n = counts[id];
				css += wsRow(id) + "::after { content: \"" + n + "\" / \"" + (n ? n + " 个活跃会话" : "没有活跃会话") + "\";" + (n ? "" : " background: transparent; color: var(--dsw-alias-label-secondary, #61666b); font-weight: 600; opacity: .7;") + (bump.has(id) ? " animation: dpm-cnt-bump 420ms cubic-bezier(.2, .8, .2, 1);" : "") + " }\n";
			}
			if (hub) css += SEC + ":has(> * > " + wsRow(hub) + "):has(> [role=\"group\"]) > * > :is([data-row-key^=\"session:\"], [data-dpm-blank]) { margin-inline-start: 12px; padding-inline-start: 8px; }\n";
			return css;
		}
		var SidebarBridge = class {
			hooks;
			onCapture = (e) => {
				const del = e.target?.closest?.("[data-dpm-del]");
				if (del) {
					e.stopPropagation();
					e.preventDefault();
					this.hooks.del(del.dataset.dpmDel, del.dataset.title);
					return;
				}
				const blank = e.target?.closest?.("[data-dpm-blank]");
				if (blank) {
					e.stopPropagation();
					e.preventDefault();
					this.hooks.open(blank.dataset.dpmBlank);
					return;
				}
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
			blanks = {};
			/** 0.20 正在新建的会话：工作区 id + 卡片标题（会话建好前侧栏先出现一行占位）。 */
			pending = null;
			hide = null;
			obs = null;
			raf = 0;
			constructor(hooks) {
				this.hooks = hooks;
			}
			start() {
				document.addEventListener("click", this.onCapture, true);
				this.obs = new MutationObserver(() => {
					if (!this.raf) this.raf = requestAnimationFrame(() => {
						this.raf = 0;
						this.syncBlanks();
					});
				});
				this.obs.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["aria-expanded"]
				});
				this.style = document.createElement("style");
				this.style.dataset.plugin = "dsh-project-manager:rows";
				document.head.append(this.style);
				this.hide = document.createElement("style");
				this.hide.dataset.plugin = "dsh-project-manager:blank-current";
				document.head.append(this.hide);
			}
			stop() {
				document.removeEventListener("click", this.onCapture, true);
				this.obs?.disconnect();
				this.obs = null;
				if (this.raf) cancelAnimationFrame(this.raf);
				this.raf = 0;
				document.querySelectorAll("[data-dpm-blank-ws]").forEach((n) => n.remove());
				clearTimeout(this.bumpTimer);
				this.style?.remove();
				this.style = null;
				this.hide?.remove();
				this.hide = null;
			}
			/** 0.20 新建会话期间的占位行（null = 去掉）。 */
			setPending(p) {
				this.pending = p;
				this.syncBlanks();
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
			/** 0.12：更新补画数据并立即同步。 */
			setBlanks(map) {
				this.blanks = map;
				this.syncBlanks();
			}
			/**
			* 每个目标工作区：行展开着 → 在它的标题行后面放补画行（与期望一致且位置没被挤走就不动）；收起 / 不再需要 → 移除。
			* 只碰带 data-dpm-blank-ws 的自有节点，不改宿主节点。
			*/
			syncBlanks() {
				if (!this.obs) return;
				const want = { ...this.blanks };
				if (this.pending) want[this.pending.ws] = [{
					id: "__pending",
					title: this.pending.title,
					pending: true
				}, ...want[this.pending.ws] ?? []];
				const hidden = [];
				document.querySelectorAll("[data-dpm-blank-ws]").forEach((n) => {
					if (!want[n.dataset.dpmBlankWs]) n.remove();
				});
				for (const [ws, rows] of Object.entries(want)) {
					const head = document.querySelector(wsRow(ws));
					const sec = head?.closest(SEC);
					const holder = head && sec ? Array.from(sec.children).find((c) => c.contains(head)) : void 0;
					const mine = Array.from(document.querySelectorAll("[data-dpm-blank-ws=\"" + CSS.escape(ws) + "\"]"));
					if (!head || !sec || !holder || head.getAttribute("aria-expanded") !== "true") {
						mine.forEach((n) => n.remove());
						continue;
					}
					for (const r of rows) if (r.current) hidden.push(r.id);
					const canDel = this.hooks.canDelete();
					const sigOf = (r) => r.id + "\0" + r.title + "\0" + canDel + "\0" + (r.current ? 1 : 0) + (r.pending ? 1 : 0);
					const sig = rows.map(sigOf).join("");
					let at = holder;
					if (mine.length === rows.length && mine.every((n) => {
						const ok = n.previousElementSibling === at;
						at = n;
						return ok;
					}) && mine.map((n) => n.dataset.sig).join("") === sig) continue;
					mine.forEach((n) => n.remove());
					let prev = holder;
					for (const r of rows) {
						const w = document.createElement("span");
						w.className = "dpm-blank-w";
						w.dataset.dpmBlankWs = ws;
						w.dataset.sig = sigOf(r);
						const b = document.createElement("button");
						b.type = "button";
						b.className = "dpm-blank" + (r.current ? " cur" : "") + (r.pending ? " pend" : "");
						if (r.pending) {
							b.disabled = true;
							b.setAttribute("aria-busy", "true");
						} else b.dataset.dpmBlank = r.id;
						if (r.current) b.setAttribute("aria-current", "page");
						b.title = r.pending ? "正在新建「" + r.title + "」" : "打开「" + r.title + "」（还没有对话）";
						b.innerHTML = "<span class=\"dpm-blank-s\" aria-hidden=\"true\"></span><span class=\"dpm-blank-t\"></span><span class=\"dpm-blank-tag\">" + (r.pending ? "正在新建" : "未开始") + "</span>";
						b.querySelector(".dpm-blank-t").textContent = r.title;
						w.append(b);
						if (canDel && !r.pending) {
							const x = document.createElement("button");
							x.type = "button";
							x.className = "dpm-blank-del";
							x.dataset.dpmDel = r.id;
							x.dataset.title = r.title;
							x.title = "删除（还没有对话）";
							x.setAttribute("aria-label", "删除「" + r.title + "」");
							x.innerHTML = TRASH;
							w.classList.add("can-del");
							w.append(x);
						}
						prev.after(w);
						prev = w;
					}
				}
				const css = hidden.map((id) => "[data-row-key=\"session:" + CSS.escape(id) + "\"]").join(",\n");
				const text = css ? css + " { display: none !important; }" : "";
				if (this.hide && this.hide.textContent !== text) this.hide.textContent = text;
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
		const CSS$1 = ".dpm, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts {\n  --pm-select: rgba(15, 17, 21, .06);\n  --pm-brand: #2f5fcc; --pm-brand-ink: #ffffff; --pm-brand-soft: #eaf0fd; --pm-brand-soft-2: #d9e4fb; --pm-brand-line: #c3d3f7;\n  --pm-ok: #146c3f; --pm-ok-soft: #e6faed; --pm-warn: #94480a; --pm-warn-soft: #fff3e2; --pm-warn-line: #f2c38c;\n  --pm-card: var(--dsw-alias-bg-layer-1, #ffffff); --pm-lane: #f7f8fa;\n  --pm-shadow: 0 1px 2px rgba(15, 17, 21, .06); --pm-shadow-2: 0 8px 28px rgba(15, 17, 21, .12);\n  --ease: cubic-bezier(.2, .8, .2, 1);\n}\nbody[data-ds-dark-theme] :is(.dpm, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts) {\n  --pm-select: rgba(255, 255, 255, .08);\n  --pm-brand: #6c97ff; --pm-brand-ink: #0b1020; --pm-brand-soft: #1d2a4a; --pm-brand-soft-2: #26365e; --pm-brand-line: #35508f;\n  --pm-ok: #56cc86; --pm-ok-soft: #1f3a29; --pm-warn: #f2a650; --pm-warn-soft: #33240f; --pm-warn-line: #6b4a1f;\n  --pm-card: var(--dsw-alias-bg-layer-1, #232324); --pm-lane: #1c1c1e;\n  --pm-shadow: 0 1px 2px rgba(0, 0, 0, .4); --pm-shadow-2: 0 12px 32px rgba(0, 0, 0, .5);\n}\n.dpm { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; font-size: 14px; line-height: 1.5; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }\n.dpm-pop, .dpm-dock, .dpm *, .dpm-pop *, .dpm-dock *, .dpm-dialog * { box-sizing: border-box; }\n.dpm button, .dpm input, .dpm select, .dpm textarea, .dpm-dialog button, .dpm-dialog input, .dpm-dialog select, .dpm-dialog textarea, .dpm-pop input { font: inherit; color: inherit; }\n.dpm svg.i, .dpm-pop svg.i, .dpm-dock svg.i, .dpm-dialog svg.i, .dpm-toasts svg.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n.dpm :focus-visible, .dpm-dialog :focus-visible { outline: 2px solid var(--pm-brand); outline-offset: 2px; border-radius: 8px; }\n.dpm .sr-only, .dpm-dialog .sr-only, .dpm-pop .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }\n.dpm .grow, .dpm-pop .grow, .dpm-dock .grow, .dpm-dialog .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .meta, .dpm-dialog .meta { font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm .mono, .dpm-dialog .mono { font-family: \"SF Mono\", Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; }\n.dpm-err { margin: 12px 24px 0; padding: 8px 12px; border: 1px solid var(--pm-warn-line); border-radius: 10px; background: var(--pm-warn-soft); color: var(--pm-warn); font-size: 13px; }\n\n/* ── 插件：选择项目浮层 ── */\n.dpm-pop { position: fixed; z-index: 30; width: 300px; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); box-shadow: var(--pm-shadow-2); animation: popin 180ms var(--ease); }\n@keyframes popin { from { opacity: 0; transform: translateY(-4px) scale(.98); } }\n/* 选卡片浮层：实底（显式回退色，宿主 token 缺失也不会透明）；每行两层信息；悬停与键盘共用高亮 */\n.dpm-pop { --pm-pop-bg: var(--dsw-alias-bg-layer-1, #ffffff); --pm-pop-sub: var(--dsw-alias-bg-module-platform, #f5f6f7); width: 340px; padding: 0; overflow: hidden; background: var(--pm-pop-bg); background-color: var(--pm-pop-bg); color: var(--dsw-alias-label-primary, #0f1115); transform-origin: top left; }\nbody[data-ds-dark-theme] .dpm-pop { --pm-pop-bg: var(--dsw-alias-bg-layer-1, #232324); --pm-pop-sub: var(--dsw-alias-bg-module-platform, #353638); color: var(--dsw-alias-label-primary, #f9fafb); }\n.dpm-pop .ph { padding: 12px 14px 8px; }\n.dpm-pop h3 { margin: 0; font-size: 14px; font-weight: 650; color: var(--dsw-alias-label-primary); }\n.dpm-pop .ph p { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .qw { position: relative; margin: 0 12px 8px; }\n.dpm-pop .qw svg.i { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--dsw-alias-label-secondary); pointer-events: none; }\n.dpm-pop input { width: 100%; height: 36px; margin: 0; padding: 0 12px 0 32px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--pm-pop-sub); outline: 0; transition: border-color 120ms var(--ease), box-shadow 120ms var(--ease); }\n.dpm-pop input:focus { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm-pop ul { max-height: 320px; overflow: auto; margin: 0; padding: 0 6px 6px; list-style: none; scroll-padding: 32px 0 4px; }\n.dpm-pop .grp { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; padding: 8px 8px 4px; background: var(--pm-pop-bg); font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .grp .n { margin-left: auto; font-weight: 500; }\n.dpm-pop .empty { padding: 28px 12px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .opt { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 8px 30px 8px 12px; border-radius: 8px; cursor: pointer; transition: background 120ms var(--ease); }\n.dpm-pop .opt .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }\n.dpm-pop .opt .nm mark { background: transparent; color: var(--pm-brand); font-weight: 700; }\n.dpm-pop .opt .mt { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .opt .stg { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--pm-pop-sub); color: var(--dsw-alias-label-primary); }\n.dpm-pop .opt .mm { display: inline-flex; align-items: center; gap: 3px; color: var(--pm-brand); }\n.dpm-pop .opt .mm.no { color: var(--pm-warn); }\n.dpm-pop .opt .mm svg.i, .dpm-pop .opt .go svg.i { width: 13px; height: 13px; }\n.dpm-pop .opt .go { position: absolute; right: 10px; top: 50%; display: grid; color: var(--pm-brand); opacity: 0; transform: translate(-4px, -50%); transition: opacity 120ms var(--ease), transform 120ms var(--ease); }\n.dpm-pop .opt:hover { background: var(--pm-select); }\n.dpm-pop .opt[aria-selected=\"true\"] { background: var(--pm-brand-soft); }\n.dpm-pop .opt[aria-selected=\"true\"] .nm { color: var(--pm-brand); }\n.dpm-pop .opt[aria-selected=\"true\"]::before { content: \"\"; position: absolute; left: 3px; top: 10px; bottom: 10px; width: 3px; border-radius: 3px; background: var(--pm-brand); }\n.dpm-pop .opt[aria-selected=\"true\"] .go { opacity: 1; transform: translate(0, -50%); }\n.dpm-pop .hint { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; padding: 8px 14px; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--pm-pop-sub); font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-pop .hint span { display: inline-flex; align-items: center; gap: 4px; }\n.dpm-pop kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border: 1px solid var(--dsw-alias-border-l2); border-bottom-width: 2px; border-radius: 4px; background: var(--pm-pop-bg); font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-primary); }\n/* 「新建会话」弹窗 */\n.dpm-dialog .ns-sug { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 8px 12px; border: 1px solid var(--pm-warn-line); border-radius: 10px; background: var(--pm-warn-soft); font-size: 13px; }\n.dpm-dialog .ns-sug .grow { white-space: normal; }\n.dpm-dialog .ns-sec { display: flex; align-items: center; margin: 16px 0 8px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ns-row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; transition: background 120ms var(--ease), border-color 120ms var(--ease), box-shadow 120ms var(--ease); }\n.dpm-dialog .ns-row:hover { background: var(--pm-select); }\n.dpm-dialog .ns-row:has(input:checked) { border-color: var(--pm-brand); background: var(--pm-brand-soft); box-shadow: inset 0 0 0 1px var(--pm-brand); }\n.dpm-dialog .ns-row:has(input:focus-visible) { outline: 2px solid var(--pm-brand); outline-offset: 2px; }\n.dpm-dialog .ns-row input { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--pm-brand); }\n.dpm-dialog .ns-row .txt { flex: 1; min-width: 0; }\n.dpm-dialog .ns-row .nm { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; }\n.dpm-dialog .ns-row .sub { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ns-row .sub .chip { height: 20px; }\n.dpm-dialog .ns-row .ni { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: var(--pm-brand-soft); color: var(--pm-brand); }\n.dpm-dialog .ns-row:has(input:checked) .ni { background: var(--pm-brand); color: var(--pm-brand-ink); }\n.dpm-dialog .ns-row.dis { cursor: default; }\n.dpm-dialog .ns-row.dis:hover { background: transparent; }\n.dpm-dialog .ns-row.dis .nm, .dpm-dialog .ns-row.dis .sub > span:not(.chip) { color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ns-row.fresh { animation: nsfresh 700ms var(--ease); }\n@keyframes nsfresh { 0% { background: var(--pm-brand-soft); } 100% { background: transparent; } }\n.dpm-dialog .ns-empty { padding: 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; font-size: 13px; color: var(--dsw-alias-label-secondary); text-align: center; }\n.dpm-dialog .btn.xs { flex: none; min-height: 28px; padding: 0 8px; gap: 4px; border-radius: 8px; font-size: 13px; }\n.dpm-dialog .btn.xs svg.i { width: 14px; height: 14px; }\n.dpm-dock.nolink { border-color: var(--pm-warn-line); background: var(--pm-warn-soft); }\n.dpm-dock.nolink .dock-h { color: var(--pm-warn); cursor: default; }\n.dpm-dock.nolink .dock-h .grow { white-space: normal; }\n.dpm-dock .btn.xs { display: inline-flex; align-items: center; gap: 4px; flex: none; min-height: 26px; padding: 0 8px; border: 1px solid var(--pm-warn-line); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }\n.dpm-dock .btn.xs:hover { background: var(--pm-select); }\n.dpm-dock .btn.xs svg.i { width: 13px; height: 13px; }\n\n/* ── 插件：项目看板面板 ── */\n@keyframes fadein { from { opacity: 0; } }\n:is(.dpm, .dpm-dialog) .pm-top { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid var(--dsw-alias-border-l2); flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .pm-top h1 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.3; }\n:is(.dpm, .dpm-dialog) .pm-top p { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .pm-top .ttl { flex: 1 1 260px; min-width: 0; }\n:is(.dpm, .dpm-dialog) .search { display: flex; align-items: center; gap: 8px; height: 36px; width: 220px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; }\n:is(.dpm, .dpm-dialog) .search input::placeholder { color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-weight: 600; white-space: nowrap; transition: background 160ms var(--ease), transform 120ms var(--ease); }\n:is(.dpm, .dpm-dialog) .btn:hover { background: var(--dsw-alias-button-floating-hover); }\n:is(.dpm, .dpm-dialog) .btn:active { transform: translateY(1px); }\n:is(.dpm, .dpm-dialog) .btn.primary { background: var(--pm-brand); border-color: var(--pm-brand); color: var(--pm-brand-ink); }\n:is(.dpm, .dpm-dialog) .btn.primary:hover { filter: brightness(1.08); }\n:is(.dpm, .dpm-dialog) .btn.ghost { border-color: transparent; background: transparent; }\n:is(.dpm, .dpm-dialog) .btn.ghost:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .btn.lg { width: 100%; min-height: 44px; font-size: 15px; }\n:is(.dpm, .dpm-dialog) .btn:disabled { opacity: .5; cursor: not-allowed; }\n:is(.dpm, .dpm-dialog) .ib { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .ib:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n:is(.dpm, .dpm-dialog) .pm-body { position: relative; flex: 1; min-height: 0; min-width: 0; display: flex; }\n:is(.dpm, .dpm-dialog) .board-wrap { position: relative; flex: 1; min-width: 0; overflow: auto; padding: 16px 24px 24px; }\n:is(.dpm, .dpm-dialog) .lane { min-width: 0; margin-bottom: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--pm-lane); }\n:is(.dpm, .dpm-dialog) .lane-h { display: flex; align-items: center; gap: 8px; padding: 8px 12px; flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .lane-h h2 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.4; }\n:is(.dpm, .dpm-dialog) .lane-h .meta { font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .lane-h .sp { flex: 1; }\n:is(.dpm, .dpm-dialog) .lane.collapsed .chev { transform: rotate(-90deg); }\n:is(.dpm, .dpm-dialog) .lane.collapsed .lane-in { display: none; }\n/* 卡片组头部：左侧整块点击展开/收起；右侧手柄拖动排序 */\n.dpm .lane { position: relative; }\n.dpm .lane-hit { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; align-self: stretch; margin: -4px 0 -4px -6px; padding: 4px 8px 4px 6px; border-radius: 8px; cursor: pointer; user-select: none; transition: background 120ms var(--ease); }\n.dpm .lane-hit:hover { background: var(--pm-select); }\n.dpm .lane-hit h2 { display: flex; }\n.dpm .lane-h .tg { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 4px 0 0; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; font-size: 15px; font-weight: 650; text-align: left; cursor: pointer; }\n.dpm .lane-h .tg .chev-b { width: 24px; height: 24px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary); }\n.dpm .lane-hit:hover .tg .chev-b { color: var(--dsw-alias-label-primary); }\n.dpm .lane-h .chev { transition: transform 200ms var(--ease); }\n.dpm .ib.grip { cursor: grab; touch-action: none; }\n.dpm.gdragging, .dpm.gdragging * { cursor: grabbing !important; user-select: none; }\n.dpm .lane.lifting { opacity: .5; }\n.dpm .lane.gins-before::before, .dpm .lane.gins-after::after { content: \"\"; position: absolute; left: 0; right: 0; height: 3px; border-radius: 3px; background: var(--pm-brand); pointer-events: none; }\n.dpm .lane.gins-before::before { top: -8px; }\n.dpm .lane.gins-after::after { bottom: -8px; }\n.dpm .lane.moved { animation: moved 360ms var(--ease); }\n.dpm .lane.landed { animation: lland 700ms var(--ease); }\n@keyframes lland { 0% { box-shadow: 0 0 0 2px var(--pm-brand); } 100% { box-shadow: 0 0 0 2px transparent; } }\n@media (max-width: 720px), (pointer: coarse) { .dpm .lane-h .tg { min-height: 44px; } }\n/* 详情栏原地更新：不重放滑入与各行淡入 */\n.dpm .detail.stay, .dpm .detail.stay * { animation: none !important; }\n:is(.dpm, .dpm-dialog) .lane-in { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 0 12px 12px; overflow-x: auto; }\n:is(.dpm, .dpm-dialog) .shead, .lane-b { display: grid; grid-template-columns: repeat(var(--cols), minmax(212px, 1fr)); gap: 8px; }\n:is(.dpm, .dpm-dialog) .lane-b { align-items: start; }\n:is(.dpm, .dpm-dialog) .colh { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 14px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .colh .nm { white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .colh .n { height: 20px; line-height: 20px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .cell { display: flex; flex-direction: column; gap: 8px; min-height: 96px; padding: 8px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); transition: background 160ms var(--ease), box-shadow 160ms var(--ease); }\n:is(.dpm, .dpm-dialog) .cell.over { background: var(--pm-brand-soft); box-shadow: inset 0 0 0 2px var(--pm-brand); }\n/* 每个阶段底部常驻「添加卡片」（原型 v8） */\n.dpm .addc { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background 140ms var(--ease), color 140ms var(--ease); }\n.dpm .addc:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n.dpm .cell.empty .addc { justify-content: center; min-height: 40px; border: 1px dashed var(--dsw-alias-border-l3); }\n.dpm .cell.over .addc { visibility: hidden; }\n.dpm .addc-f { display: flex; flex-direction: column; gap: 4px; animation: fadein 160ms var(--ease); }\n.dpm .addc-f input { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--pm-brand); border-radius: 8px; background: var(--pm-card); color: inherit; font: inherit; outline: 0; box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm .addc-f .hint { padding: 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n@media (max-width: 720px), (pointer: coarse) { .dpm .addc { min-height: 40px; } }\n:is(.dpm, .dpm-dialog) .card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--pm-card); box-shadow: var(--pm-shadow); text-align: left; transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease), transform 200ms var(--ease), opacity 160ms var(--ease); }\n:is(.dpm, .dpm-dialog) .card:hover { border-color: var(--dsw-alias-border-l3); box-shadow: var(--pm-shadow-2); transform: translateY(-1px); }\n:is(.dpm, .dpm-dialog) .card[aria-pressed=\"true\"] { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .card.dragging { opacity: .45; }\n:is(.dpm, .dpm-dialog) .card.landed { animation: land 420ms var(--ease); }\n@keyframes land { 0% { transform: scale(.96); } 100% { transform: none; } }\n:is(.dpm, .dpm-dialog) .card h3 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.4; word-break: break-word; }\n:is(.dpm, .dpm-dialog) .card p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n:is(.dpm, .dpm-dialog) .foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n:is(.dpm, .dpm-dialog) .prog { flex: 1; min-width: 96px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n:is(.dpm, .dpm-dialog) .bar { flex: 1; height: 4px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); overflow: hidden; }\n:is(.dpm, .dpm-dialog) .bar i { display: block; height: 100%; border-radius: 999px; background: var(--pm-brand); transition: width 400ms var(--ease); }\n:is(.dpm, .dpm-dialog) .chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .chip svg.i { width: 12px; height: 12px; }\n:is(.dpm, .dpm-dialog) .chip.warn { background: var(--pm-warn-soft); color: var(--pm-warn); border-color: var(--pm-warn-line); }\n:is(.dpm, .dpm-dialog) .chip.brand { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.plain { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .empty-board { display: grid; place-items: center; gap: 12px; padding: 48px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }\n\n/* ── 插件：详情栏 ── */\n:is(.dpm, .dpm-dialog) .detail { width: 380px; flex: none; display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); animation: slidein 240ms var(--ease); }\n@keyframes slidein { from { opacity: 0; transform: translateX(16px); } }\n:is(.dpm, .dpm-dialog) .d-h { display: flex; align-items: flex-start; gap: 8px; padding: 16px 20px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .d-h h2 { margin: 0; font-size: 18px; font-weight: 650; line-height: 1.35; word-break: break-word; }\n:is(.dpm, .dpm-dialog) .d-h .sub { margin-top: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .d-b { flex: 1; overflow: auto; padding: 0 20px 16px; }\n:is(.dpm, .dpm-dialog) .sec { padding: 16px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .sec:last-child { border-bottom: 0; }\n:is(.dpm, .dpm-dialog) .sec h3 { margin: 0 0 8px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .statebox { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }\n:is(.dpm, .dpm-dialog) .statebox .l { margin: 8px 0 0; font-size: 14px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .statebox .nx { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .statebox .nx b { margin-right: 8px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .repo { display: flex; align-items: center; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n:is(.dpm, .dpm-dialog) .repo .txt { flex: 1; min-width: 0; }\n:is(.dpm, .dpm-dialog) .repo .nm { font-size: 14px; font-weight: 650; }\n:is(.dpm, .dpm-dialog) .repo .mono { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n:is(.dpm, .dpm-dialog) .steps { display: flex; margin: 4px 0 12px; }\n:is(.dpm, .dpm-dialog) .step { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 48px; padding: 4px 0; border: 0; background: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .step::before { content: \"\"; position: absolute; top: 13px; left: -50%; width: 100%; height: 2px; background: var(--dsw-alias-border-l3); }\n:is(.dpm, .dpm-dialog) .step:first-child::before { display: none; }\n:is(.dpm, .dpm-dialog) .step .nd { position: relative; z-index: 1; width: 20px; height: 20px; display: grid; place-items: center; border: 2px solid var(--dsw-alias-border-l3); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--pm-brand-ink); transition: background 200ms var(--ease), border-color 200ms var(--ease), box-shadow 200ms var(--ease); }\n:is(.dpm, .dpm-dialog) .step .nd svg.i { width: 12px; height: 12px; stroke-width: 3; }\n:is(.dpm, .dpm-dialog) .step.past .nd { background: var(--pm-brand); border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .step.past::before, .step.cur::before { background: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .step.cur { color: var(--dsw-alias-label-primary); font-weight: 650; }\n:is(.dpm, .dpm-dialog) .step.cur .nd { border-color: var(--pm-brand); box-shadow: 0 0 0 4px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .step:hover .nd { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .task { display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 4px 8px; border-radius: 8px; font-size: 14px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .task:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .task input { width: 16px; height: 16px; accent-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .task.done span { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }\n:is(.dpm, .dpm-dialog) .addtask { display: flex; gap: 8px; margin-top: 8px; }\n:is(.dpm, .dpm-dialog) .addtask input { flex: 1; min-width: 0; height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); outline: 0; }\n:is(.dpm, .dpm-dialog) .addtask input:focus { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .psess { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; margin-bottom: 4px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; font-size: 14px; }\n:is(.dpm, .dpm-dialog) .psess:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .psess .t { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .d-f { display: flex; flex-direction: column; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }\n:is(.dpm, .dpm-dialog) .d-f .note { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n\n/* ── 插件：记忆关联 ── */\n:is(.dpm, .dpm-dialog) .chip.mem { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.as-btn { cursor: pointer; font-family: inherit; }\n:is(.dpm, .dpm-dialog) .chip.as-btn:hover { background: var(--pm-brand-soft-2); }\n:is(.dpm, .dpm-dialog) .btn.sm { min-height: 28px; padding: 0 8px; font-size: 13px; }\n:is(.dpm, .dpm-dialog) .meta.mb { margin: 0 0 8px; }\n:is(.dpm, .dpm-dialog) .mrow { display: flex; gap: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); animation: fadein 220ms var(--ease); }\n:is(.dpm, .dpm-dialog) .mrow .txt { flex: 1; min-width: 0; }\n:is(.dpm, .dpm-dialog) .mrow .nm { font-size: 14px; font-weight: 650; word-break: break-all; }\n:is(.dpm, .dpm-dialog) .mrow .l { margin: 4px 0 0; font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .mrow .nx { margin: 8px 0 0; padding: 8px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.5; }\n:is(.dpm, .dpm-dialog) .mrow .nx b { margin-right: 8px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .mside { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }\n/* 0.11：关联的落盘项目默认只显示标题，一个按钮全部展开 / 收起 */\n.dpm .mlist:not(.open) .mrow { align-items: center; padding: 8px 8px 8px 12px; }\n.dpm .mlist:not(.open) .mrow .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: normal; }\n.dpm .mlist:not(.open) .mrow .more { display: none; }\n.dpm .mlist:not(.open) .mside { flex-direction: row; align-items: center; }\n.dpm .mlist.open .mrow .more { animation: fadein 200ms var(--ease); }\n.dpm .mlist .mrow .more .mono { display: block; margin-top: 2px; }\n.dpm .mem-tg svg.i { width: 14px; height: 14px; transition: transform 180ms var(--ease); }\n.dpm .mem-tg[aria-expanded=\"true\"] svg.i { transform: rotate(180deg); }\n/* 0.12：详情列表「展示更多 / 折叠」 */\n.dpm .more-tg { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 32px; margin-top: 2px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: 10px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; font-weight: 600; }\n.dpm .more-tg:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n.dpm .more-tg svg.i { width: 14px; height: 14px; transition: transform 180ms var(--ease); }\n.dpm .more-tg[aria-expanded=\"true\"] svg.i { transform: rotate(180deg); }\n:is(.dpm, .dpm-dialog) .gl-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px 4px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n:is(.dpm, .dpm-dialog) .gl-row .nm { font-weight: 650; }\n:is(.dpm, .dpm-dialog) .pk-list { max-height: 50vh; overflow: auto; }\n:is(.dpm, .dpm-dialog) .pk { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .pk:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .pk input { margin-top: 4px; accent-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .pk.lock { opacity: .7; cursor: default; }\n:is(.dpm, .dpm-dialog) .pk .nm { font-weight: 650; }\n:is(.dpm, .dpm-dialog) .pk-grp { margin: 12px 0 8px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .pk-grp:first-child { margin-top: 0; }\n:is(.dpm, .dpm-dialog) .card.dragging { opacity: .4; }\n:is(.dpm, .dpm-dialog) .cell .card { position: relative; }\n:is(.dpm, .dpm-dialog) .card.ins-before::before, .card.ins-after::after { content: \"\"; position: absolute; left: 4px; right: 4px; height: 3px; border-radius: 999px; background: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n:is(.dpm, .dpm-dialog) .card.ins-before::before { top: -6px; }\n:is(.dpm, .dpm-dialog) .card.ins-after::after { bottom: -6px; }\n:is(.dpm, .dpm-dialog) .card.moved { animation: moved 360ms var(--ease); }\n@keyframes moved { from { transform: translateY(var(--dy, 0)); } }\n\n/* ── 对话框 / toast ── */\n.dpm-dialog { width: min(560px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--pm-shadow-2); }\n.dpm-dialog::backdrop { background: rgba(15, 17, 21, .32); }\n.dpm-dialog[open] { animation: popin 220ms var(--ease); }\n:is(.dpm, .dpm-dialog) .dlg-h { padding: 20px 20px 4px; }\n:is(.dpm, .dpm-dialog) .dlg-h h2 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.4; }\n:is(.dpm, .dpm-dialog) .dlg-h p { margin: 4px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .dlg-b { padding: 12px 20px; max-height: 60vh; overflow: auto; }\n:is(.dpm, .dpm-dialog) .dlg-b label.lbl { display: block; margin: 8px 0 4px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .fld { width: 100%; height: 36px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); outline: 0; }\n:is(.dpm, .dpm-dialog) textarea.fld { height: auto; padding: 8px 12px; resize: vertical; }\n/* 0.10：下拉框用自绘箭头，距右边 12px，和输入框左内边距对称 */\n:is(.dpm, .dpm-dialog) select.fld { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer; text-overflow: ellipsis; background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\"); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px 16px; }\nbody[data-ds-dark-theme] :is(.dpm, .dpm-dialog) select.fld { background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\"); }\n:is(.dpm, .dpm-dialog) .fld:focus { border-color: var(--pm-brand); }\n:is(.dpm, .dpm-dialog) .dlg-f { display: flex; align-items: center; gap: 8px; padding: 12px 20px 20px; }\n:is(.dpm, .dpm-dialog) .dlg-f .sp { flex: 1; }\n:is(.dpm, .dpm-dialog) .st-row { display: grid; grid-template-columns: 24px 1fr 32px; gap: 8px; align-items: center; margin-bottom: 8px; }\n:is(.dpm, .dpm-dialog) .st-row .grip { text-align: center; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .st-row label { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n:is(.dpm, .dpm-dialog) .imp { display: flex; align-items: flex-start; gap: 12px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; cursor: pointer; }\n:is(.dpm, .dpm-dialog) .imp:hover { background: var(--pm-select); }\n:is(.dpm, .dpm-dialog) .imp input { margin-top: 4px; accent-color: var(--pm-brand); }\n.dpm-toasts { position: fixed; left: 50%; bottom: 24px; z-index: 50; display: flex; flex-direction: column; gap: 8px; transform: translateX(-50%); pointer-events: none; }\n.dpm-toasts .toast { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 12px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 13px; box-shadow: var(--pm-shadow-2); animation: popin 240ms var(--ease); }\n\n@media (max-width: 1100px) { .dpm .detail { position: absolute; top: 0; right: 0; bottom: 0; z-index: 20; box-shadow: var(--pm-shadow-2); } }\n@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }\n\n.dpm .pm-top, .dpm .pm-body { animation: fadein 220ms var(--ease); }\n.dpm-toasts { position: fixed; left: 50%; bottom: 24px; z-index: 2147483000; display: flex; flex-direction: column; gap: 8px; transform: translateX(-50%); pointer-events: none; }\n.dpm-toasts .toast.err { background: var(--pm-warn); color: #fff; }\n.dpm-pop { position: fixed; z-index: 2147482000; width: 300px; }\n.dpm .pm-top .ttl { flex: 1 1 260px; min-width: 0; }\n.dpm .ib.sm { width: 24px; height: 24px; }\n.dpm .ib.sm svg.i { width: 14px; height: 14px; }\n.dpm .task { justify-content: space-between; }\n.dpm .task label { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; cursor: pointer; }\n.dpm .task .ib.sm { opacity: 0; }\n.dpm .task:hover .ib.sm, .dpm .task .ib.sm:focus-visible { opacity: 1; }\n.dpm .btn.danger, .dpm-dialog .btn.danger { color: var(--pm-warn); }\n.dpm-dialog.wide { width: min(640px, calc(100vw - 32px)); }\n.dpm-dialog .lbl.row { display: flex; align-items: center; gap: 8px; }\n.dpm-dialog .rp-row { display: grid; grid-template-columns: minmax(120px, 1fr) 88px minmax(140px, 1.6fr) 32px; gap: 4px 8px; align-items: center; margin-bottom: 8px; }\n.dpm-dialog .rp-row .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-dialog .rp-err { grid-column: 1 / -1; margin: 0; font-size: 12px; color: #c62828; }\n.dpm-dialog .fld.bad { border-color: #c62828; }\nbody[data-ds-dark-theme] .dpm-dialog .rp-err { color: #ff8a80; }\nbody[data-ds-dark-theme] .dpm-dialog .fld.bad { border-color: #ff8a80; }\n/* 添加挂载仓库（原型 v9） */\n.dpm-dialog .ar-top, .dpm-dialog .ar-manual { display: flex; align-items: center; gap: 8px; }\n.dpm-dialog .ar-manual { margin-top: 8px; }\n.dpm-dialog .ar-top .fld, .dpm-dialog .ar-manual .fld { flex: 1; min-width: 0; }\n.dpm-dialog [hidden] { display: none !important; }\n.dpm-dialog .ar-sec { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ar-sec .meta { font-weight: 400; }\n.dpm-dialog .ar-list { max-height: 28vh; margin-top: 0; }\n.dpm-dialog .pk .txt { flex: 1; min-width: 0; }\n.dpm-dialog .pk .txt .mono { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-dialog .pk > .chip { flex: none; margin-left: auto; align-self: center; }\n/* 本卡片的会话（原型 v10） */\n.dpm .lsess { margin-bottom: 4px; padding: 6px 4px 6px 8px; border-radius: 8px; }\n.dpm .lsess:hover { background: var(--pm-select); }\n.dpm .lsess .l1 { display: flex; align-items: center; gap: 8px; }\n.dpm .lsess .l2 { display: flex; align-items: center; gap: 8px; min-height: 28px; margin-top: 2px; }\n.dpm .lsess .l2 .sub2 { flex: 1; min-width: 0; }\n.dpm .lsess .lname { flex: 1; min-width: 0; display: block; padding: 0; border: 0; background: none; color: inherit; font: inherit; font-size: 14px; font-weight: 600; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }\n.dpm .lsess button.lname:hover { color: var(--pm-brand); text-decoration: underline; }\n.dpm .lsess .sub2 { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .lsess.gone .lname, .dpm .lsess.archived .lname { color: var(--dsw-alias-label-secondary); cursor: default; }\n.dpm .lsess.gone .lname { font-weight: 400; }\n.dpm .lsess .chip, :is(.dpm, .dpm-dialog) .ls-row .chip { flex: none; }\n:is(.dpm, .dpm-dialog) .chip.live { background: var(--pm-brand-soft); color: var(--pm-brand); border-color: var(--pm-brand-line); }\n:is(.dpm, .dpm-dialog) .chip.arch { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); }\n.dpm .btn.xs { flex: none; min-height: 28px; padding: 0 8px; gap: 4px; border-radius: 8px; font-size: 13px; }\n.dpm .btn.xs svg.i { width: 14px; height: 14px; }\n.dpm .ib.unl { flex: none; }\n.dpm .ib.unl:hover { color: #c62828; background: rgba(198, 40, 40, .08); }\nbody[data-ds-dark-theme] .dpm .ib.unl:hover { color: #ff8a80; background: rgba(255, 138, 128, .12); }\n.dpm .tipbtn { position: relative; }\n.dpm .tipbtn .tip { position: absolute; right: 0; top: calc(100% + 4px); z-index: 5; padding: 4px 8px; border-radius: 6px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-size: 12px; font-weight: 600; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 120ms var(--ease); }\n.dpm .tipbtn:hover .tip, .dpm .tipbtn:focus-visible .tip { opacity: 1; }\n.dpm-dialog.xwide { width: min(760px, calc(100vw - 32px)); }\n.dpm-dialog .ls-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }\n.dpm-dialog .ls-col { min-width: 0; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm-dialog .ls-col h3 { margin: 0 0 8px; padding: 0 4px; font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-list { max-height: 30vh; overflow: auto; }\n.dpm-dialog .ls-grp { display: flex; align-items: center; gap: 6px; margin: 12px 4px 4px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-grp:first-child { margin-top: 0; }\n.dpm-dialog .ls-grp svg.i { width: 14px; height: 14px; }\n.dpm-dialog .ls-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px; border-radius: 8px; cursor: pointer; }\n.dpm-dialog .ls-row:hover { background: var(--pm-select); }\n.dpm-dialog .ls-row input { flex: none; accent-color: var(--pm-brand); }\n.dpm-dialog .ls-row .txt { flex: 1; min-width: 0; }\n.dpm-dialog .ls-row .nm { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }\n.dpm-dialog .ls-row .oth { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--pm-warn); }\n.dpm-dialog .ls-row .t { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ls-row .chip { height: 22px; font-weight: 400; }\n.dpm-dialog .ls-empty { margin: 8px 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog #dpmLsSel .ls-row { margin-bottom: 4px; border: 1px solid var(--pm-brand-line); background: var(--pm-brand-soft); }\n.dpm-dialog .btn.primary.danger-fill { background: #c62828; border-color: #c62828; color: #ffffff; }\n@media (max-width: 720px) { .dpm-dialog .ls-cols { grid-template-columns: 1fr; } }\n.dpm-dialog .ar-empty { margin: 0; padding: 16px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: 10px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .st-row .grip { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .pk-list { margin-top: 12px; }\n@media (prefers-reduced-motion: reduce) { .dpm *, .dpm-pop, .dpm-dock, .dpm-dialog, .dpm-toasts * { animation-duration: 1ms !important; transition-duration: 1ms !important; } }\n\n.dpm-dock { box-sizing: border-box; width: calc(100% - var(--dsh-composer-side-clearance, 0px) * 2); max-width: var(--dsh-composer-card-max-width, 100%); margin: 0 auto 8px; border: 1px solid var(--pm-brand-line); border-radius: 12px; background: var(--pm-brand-soft); color: var(--dsw-alias-label-primary); animation: fadein 240ms var(--ease); }\n.dpm-dock .dock-h { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 12px; border: 0; background: transparent; color: var(--pm-brand); font: inherit; font-size: 13px; font-weight: 650; text-align: left; cursor: pointer; }\n.dpm-dock .dock-h .grow { display: flex; align-items: center; gap: 8px; }\n.dpm-dock .chev { display: inline-flex; transition: transform 200ms var(--ease); }\n.dpm-dock.open .chev { transform: rotate(180deg); }\n.dpm-dock ul { margin: 0; padding: 0 12px 10px; list-style: none; display: flex; flex-direction: column; gap: 4px; }\n.dpm-dock li { display: flex; gap: 8px; font-size: 13px; line-height: 1.5; }\n.dpm-dock li b { flex: none; font-weight: 650; }\n.dpm-dock li span { color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n/* design-review 修正 */\n.dpm-dialog .imp .meta, .dpm-dialog .pk .meta { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n.dpm-dialog #dpmImList { max-height: 46vh; overflow: auto; }\n.dpm .lane-b { align-items: stretch; }\n.dpm .btn.danger, .dpm-dialog .btn.danger { color: #c62828; }\nbody[data-ds-dark-theme] :is(.dpm, .dpm-dialog) .btn.danger { color: #ff8a80; }\n.dpm-dialog .dlg-b > .lbl { margin-top: 20px; }\n.dpm-dialog .dlg-b > .lbl:first-child { margin-top: 0; }\n.dpm-dialog #dpmStAdd { margin: 4px 0 8px; }\n\n\n/* ── v0.7：卡片会话标志（有活跃 = 绿，全归档 = 灰；不闪动）── */\n:is(.dpm, .dpm-dialog) .foot:empty { display: none; }\n:is(.dpm, .dpm-dialog) .chip.ok { background: var(--pm-ok-soft); color: var(--pm-ok); }\n.dpm .chip.sess { gap: 5px; }\n.dpm .chip.sess .bub { position: relative; display: grid; }\n.dpm .chip.sess .bub i { position: absolute; right: -2px; top: -2px; width: 6px; height: 6px; border-radius: 999px; box-shadow: 0 0 0 1.5px var(--pm-card); }\n.dpm .chip.sess.on { background: var(--pm-ok-soft); color: var(--pm-ok); border-color: color-mix(in srgb, var(--pm-ok) 28%, transparent); }\n.dpm .chip.sess.on .bub i { background: var(--pm-ok); }\n.dpm .chip.sess.off { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); }\n.dpm .chip.sess.off .bub i { background: var(--dsw-alias-label-secondary); opacity: .55; }\n/* ── v0.7：相关说明 ── */\n.dpm .note-in { display: block; width: 100%; min-height: 128px; max-height: 50vh; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 14px; line-height: 1.6; resize: vertical; outline: 0; field-sizing: content; }\n.dpm .note-in:focus { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); background: var(--dsw-alias-bg-layer-1); }\n.dpm .note-bar { display: flex; align-items: center; gap: 8px; margin-top: 8px; }\n.dpm .note-bar .meta { font-variant-numeric: tabular-nums; }\n.dpm .note-view { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }\n.dpm .note-view a { color: var(--pm-brand); text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }\n.dpm .note-view a:hover { text-decoration-thickness: 2px; }\n/* ── 0.10：相关说明超长折叠（不再内部滚动）── */\n.dpm .note-wrap.clamp .note-view { max-height: 172px; overflow: hidden; -webkit-mask-image: linear-gradient(#000 calc(100% - 44px), transparent); mask-image: linear-gradient(#000 calc(100% - 44px), transparent); }\n.dpm .note-more { margin-top: 4px; color: var(--pm-brand); }\n.dpm .note-more[hidden] { display: none; }\n.dpm .note-more svg.i { transition: transform 160ms var(--ease); }\n.dpm .note-more[aria-expanded=\"true\"] svg.i { transform: rotate(180deg); }\n/* ── 0.10：相关链接 ── */\n.dpm .wl-list { display: flex; flex-direction: column; gap: 6px; }\n.dpm .wl { position: relative; display: flex; align-items: center; gap: 4px; min-height: 40px; padding: 4px 4px 4px 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }\n.dpm .wl:hover { border-color: var(--dsw-alias-border-l3); }\n.dpm .wl .wgrip { flex: none; width: 22px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--dsw-alias-label-secondary); opacity: .45; cursor: grab; touch-action: none; }\n.dpm .wl .wgrip svg.i { width: 14px; height: 14px; }\n.dpm .wl:hover .wgrip, .dpm .wl .wgrip:focus-visible { opacity: 1; }\n.dpm .wl .wl-a { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 4px 2px; color: var(--dsw-alias-label-primary); text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px; }\n.dpm .wl .wl-a.ro { padding-left: 8px; }\n.dpm .wl .wl-a svg.i { flex: none; color: var(--dsw-alias-label-secondary); }\n.dpm .wl .wl-a .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm .wl .wl-a:hover .t { color: var(--pm-brand); text-decoration: underline; text-underline-offset: 2px; }\n.dpm .wl .chip { flex: none; height: 20px; }\n/* 0.20：编辑 / 删除常驻显示（拖动把手仍是悬停出现） */\n.dpm .wl .acts { display: flex; gap: 2px; flex: none; }\n@media (hover: none) { .dpm .wl .acts, .dpm .wl .wgrip { opacity: 1; } }\n.dpm .wl .ib.sm { width: 28px; height: 28px; }\n.dpm .wl .ib.del:hover { color: #c62828; background: rgba(198, 40, 40, .08); }\nbody[data-ds-dark-theme] .dpm .wl .ib.del:hover { color: #ff8a80; }\n.dpm .wl.lifting { opacity: .45; }\n.dpm .wl.wins-before::before, .dpm .wl.wins-after::after { content: \"\"; position: absolute; left: 4px; right: 4px; height: 3px; border-radius: 999px; background: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); pointer-events: none; }\n.dpm .wl.wins-before::before { top: -5px; }\n.dpm .wl.wins-after::after { bottom: -5px; }\n.dpm .wl.landed { animation: land 420ms var(--ease); }\n.dpm.wdragging, .dpm.wdragging * { cursor: grabbing !important; user-select: none; }\n.dpm-dialog .wl-rows { display: flex; flex-direction: column; gap: 10px; }\n.dpm-dialog .wl-row { padding: 10px 12px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm-dialog .wl-row-h { display: flex; align-items: center; gap: 8px; min-height: 24px; margin-bottom: 4px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .wl-row-h .ib.sm { width: 28px; height: 28px; }\n.dpm-dialog .wl-grid { display: grid; grid-template-columns: minmax(0, 1fr) 148px; gap: 4px 8px; align-items: end; }\n.dpm-dialog .wl-grid .full { grid-column: 1 / -1; }\n.dpm-dialog .wl-grid .lbl { display: block; margin: 6px 0 4px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .wl-tnew { display: flex; gap: 4px; }\n.dpm-dialog .wl-tnew .fld { min-width: 0; }\n.dpm-dialog .wl-tnew .btn { flex: none; min-height: 36px; padding: 0 10px; }\n.dpm-dialog .wl-err { margin: 4px 0 0; font-size: 12px; color: #c62828; }\nbody[data-ds-dark-theme] .dpm-dialog .wl-err { color: #ff8a80; }\n.dpm-dialog .wl-add { margin-top: 10px; }\n@media (max-width: 720px) { .dpm-dialog .wl-grid { grid-template-columns: 1fr; } }\n/* ── v0.7：相关文件 ── */\n.dpm .frow-f { display: flex; align-items: flex-start; gap: 10px; padding: 8px 6px 8px 10px; margin-bottom: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm .frow-f > svg.i { margin-top: 2px; color: var(--dsw-alias-label-secondary); }\n.dpm .frow-f .txt { flex: 1; min-width: 0; }\n.dpm .frow-f .nm { font-size: 14px; font-weight: 600; word-break: break-all; }\n.dpm .frow-f .mono { display: block; margin-top: 2px; line-height: 1.45; }\n.dpm .frow-f .chip { height: 20px; margin-top: 6px; }\n.dpm .frow-f.gone { border-style: dashed; }\n.dpm .frow-f.gone > svg.i { color: var(--pm-warn); }\n.dpm .frow-f.gone .nm { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }\n\n/* ── 0.8 卡片归档（原型 v19） ── */\n/* 卡片组头部不折行：名称/统计可截断，右侧按钮始终一排，「已归档卡片」紧贴「新会话」 */\n@media (min-width: 721px) {\n  .dpm .lane-h { flex-wrap: nowrap; }\n  .dpm .lane-hit { flex: 1 1 0; flex-wrap: nowrap; overflow: hidden; }\n  .dpm .lane-hit .meta { flex: 0 1000 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }\n  .dpm .lane-hit h2 { flex: 0 1 auto; min-width: 48px; }\n  .dpm .lane-hit h2 .tg { min-width: 0; }\n  .dpm .lane-hit h2 .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n  .dpm .lane-hit .chip { flex: none; }\n  .dpm .lane-h > .btn, .dpm .lane-h > .ib { flex: none; }\n}\n.dpm .card { position: relative; }\n.dpm .card h3 { padding-right: 22px; }\n.dpm .card .carc { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; opacity: 0; transition: opacity 120ms var(--ease), background 120ms var(--ease), color 120ms var(--ease); }\n.dpm .card:hover .carc, .dpm .card:focus-within .carc, .dpm .card .carc:focus-visible { opacity: 1; }\n@media (pointer: coarse) { .dpm .card .carc { opacity: 1; } }\n.dpm .card.leaving { animation: dpmleave 220ms var(--ease) forwards; pointer-events: none; }\n@keyframes dpmleave { to { opacity: 0; transform: scale(.94) translateY(-4px); } }\n.dpm .btn .cnt { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); font-size: 12px; font-weight: 650; line-height: 20px; text-align: center; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n.dpm .lane-h .btn[aria-expanded=\"true\"] { background: var(--pm-brand-soft); color: var(--pm-brand); }\n.dpm .lane-h .btn[aria-expanded=\"true\"] .cnt { background: var(--pm-brand); color: var(--pm-brand-ink); }\n.dpm .atray { margin: 0 12px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; outline: 2px dashed transparent; outline-offset: -2px; animation: dpmtray 160ms var(--ease); transition: outline-color 120ms var(--ease); }\n@keyframes dpmtray { from { opacity: 0; transform: translateY(-4px); } }\n.dpm .lane.collapsed .atray { display: none; }\n.dpm .atray-h { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dpm .atray-l { max-height: 296px; overflow: auto; padding: 6px; }\n.dpm .arow { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 3px 3px 3px 7px; border: 1px solid transparent; border-radius: 8px; cursor: pointer; transition: border-color 200ms var(--ease), box-shadow 200ms var(--ease); }\n.dpm .arow + .arow { margin-top: 2px; }\n.dpm .arow:hover { background: var(--pm-select); }\n/* 选中 = 与活跃卡片选中同一套：蓝色边框 + 浅蓝外圈 */\n.dpm .arow[aria-current=\"true\"] { background: var(--pm-card); border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm .arow[aria-current=\"true\"] .nm { font-weight: 600; }\n.dpm .arow .txt { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 12px; }\n.dpm .arow .nm { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); }\n.dpm .arow .sub { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm .arow.leaving { animation: dpmrowout 220ms var(--ease) forwards; }\n@keyframes dpmrowout { to { opacity: 0; transform: translateX(12px); } }\n.dpm .arow.landed { animation: lland 700ms var(--ease); }\n.dpm .ib.rst { flex: none; width: 28px; height: 28px; opacity: 0; }\n.dpm .arow:hover .ib.rst, .dpm .arow:focus-within .ib.rst, .dpm .arow[aria-current=\"true\"] .ib.rst, .dpm .ib.rst:focus-visible { opacity: 1; }\n@media (pointer: coarse) { .dpm .ib.rst { opacity: 1; } }\n/* 列表是滚动容器：提示放到图标左侧同一行，最后一行也不会被裁掉 */\n.dpm .ib.rst .tip { top: 50%; right: calc(100% + 6px); transform: translateY(-50%); }\n.dpm.carddrag .atray { outline-color: var(--dsw-alias-border-l3); }\n.dpm .atray.over { outline: 2px solid var(--pm-brand); }\n.dpm .atray-drop { display: none; align-items: center; justify-content: center; min-height: 40px; margin: 0 0 4px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm.carddrag .atray-drop { display: flex; }\n.dpm .atray.over .atray-drop { color: var(--pm-brand); }\n.dpm.carddrag .atray-empty { display: none; }\n.dpm .atray-empty { margin: 0; padding: 20px 12px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n/* 已归档详情：标题下一条细状态栏，说明 + 恢复按钮同一行；正文无操作入口 */\n.dpm .arch-bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 20px; border-bottom: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm .arch-bar .txt { flex: 1; min-width: 0; }\n.dpm .arch-bar b { font-weight: 650; color: var(--dsw-alias-label-primary); }\n.dpm .detail.ro .step, .dpm .detail.ro .task { cursor: default; }\n.dpm .detail.ro .step:hover .nd { border-color: var(--dsw-alias-border-l3); }\n.dpm .detail.ro .step.past:hover .nd, .dpm .detail.ro .step.cur:hover .nd { border-color: var(--pm-brand); }\n.dpm .lsess .acts { display: flex; gap: 2px; flex: none; margin-left: auto; }\n.dpm-toasts .toast .ta { pointer-events: auto; margin-left: 8px; padding: 2px 8px; border: 0; border-radius: 6px; background: rgba(255, 255, 255, .16); color: inherit; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }\nbody[data-ds-dark-theme] .dpm-toasts .toast .ta { background: rgba(0, 0, 0, .12); }\n.dpm-dialog .cf-list { margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n\n/* ── 0.9 全局面板「项目看板」主按钮（原型 v15-panel2）──\n   宿主行 = button:has(> * > .dpm-entry)（只认插件自己的图标块，不依赖宿主哈希类名）；规则失效时退化为普通图标行。 */\n@property --dpm-rim { syntax: \"<angle>\"; inherits: false; initial-value: 0deg; }\nbutton:has(.dpm-entry) {\n  --dpm-a: #2f5fcc; --dpm-b: #0a7d9c; --dpm-ink: #1f4fb8; --dpm-side: var(--dsw-specific-sidebar-fill, #f9fafb);\n  --ease: cubic-bezier(.2, .8, .2, 1);\n  position: relative; isolation: isolate; overflow: hidden; min-height: 42px; margin-block: 2px 4px; border-radius: 12px;\n  color: var(--dpm-ink) !important; font-weight: 650;\n  background: linear-gradient(115deg, color-mix(in srgb, var(--dpm-a) 11%, var(--dpm-side)) 0%, color-mix(in srgb, var(--dpm-b) 13%, var(--dpm-side)) 100%) !important;\n  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dpm-a) 26%, transparent), 0 1px 2px rgba(15, 17, 21, .05);\n  transition: transform 220ms var(--ease), box-shadow 260ms var(--ease), color 220ms var(--ease);\n}\nbody[data-ds-dark-theme] button:has(.dpm-entry) { --dpm-ink: #b9ccff; --dpm-side: var(--dsw-specific-sidebar-fill, #1c1c1e); box-shadow: inset 0 0 0 1px color-mix(in srgb, #8fb0ff 30%, transparent); }\n/* 宿主图标槽必须保持 static，光效层/徽标才能以整行为定位基准；标题文字盖在光效层上 */\nbutton:has(.dpm-entry) > :has(.dpm-entry), button:has(.dpm-entry) > :has(.dpm-entry) :has(.dpm-entry) { position: static !important; }\nbutton:has(.dpm-entry) > :not(:has(.dpm-entry)) { position: relative; z-index: 2; }\n/* 图标栏：角标以图标块为基准 */\nbutton:has(.dpm-entry.rail) > :has(.dpm-entry) { position: relative !important; }\nbutton:has(.dpm-entry):hover { transform: translateY(-1px); background: linear-gradient(115deg, color-mix(in srgb, var(--dpm-a) 16%, var(--dpm-side)) 0%, color-mix(in srgb, var(--dpm-b) 19%, var(--dpm-side)) 100%) !important; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dpm-a) 40%, transparent), 0 6px 18px color-mix(in srgb, var(--dpm-a) 22%, transparent); }\nbutton:has(.dpm-entry):active { transform: translateY(0) scale(.975); transition-duration: 90ms; }\nbutton:has(.dpm-entry[data-active=\"true\"]) { color: #ffffff !important; background: linear-gradient(115deg, var(--dpm-a) 0%, var(--dpm-b) 100%) !important; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .22), 0 8px 22px color-mix(in srgb, var(--dpm-a) 38%, transparent); transform: none; }\nbutton:has(.dpm-entry[data-active=\"true\"]):hover { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .3), 0 10px 26px color-mix(in srgb, var(--dpm-b) 42%, transparent); }\nbutton:has(.dpm-entry):focus-visible { outline: 2px solid var(--dpm-a); outline-offset: 2px; }\n/* 图标块（宿主给 16/18px 的槽位，插件块 24px） */\n.dpm-entry { position: static; display: inline-grid; place-items: center; width: 24px; height: 24px; margin: -4px -2px; }\n.dpm-entry .pgw { position: relative; z-index: 2; width: 24px; height: 24px; }\n.dpm-entry .pg { position: relative; width: 24px; height: 24px; display: grid; place-items: center; overflow: hidden; border-radius: 8px; color: #ffffff; background: linear-gradient(135deg, var(--dpm-a), var(--dpm-b)); box-shadow: 0 2px 8px color-mix(in srgb, var(--dpm-a) 35%, transparent), inset 0 0 0 1px rgba(255, 255, 255, .2); transition: background 220ms var(--ease), color 220ms var(--ease), transform 160ms var(--ease); }\n.dpm-entry .pgi { width: 16px; height: 16px; overflow: visible; }\n.dpm-entry .pgi rect { fill: currentColor; stroke: none; transform-box: fill-box; transform-origin: 50% 0; }\n.dpm-entry .pgi .b2 { fill: color-mix(in srgb, currentColor 55%, transparent); }\n.dpm-entry .pgi .drop { opacity: 0; fill: var(--dpm-a); transform-origin: 50% 50%; }\n.dpm-entry[data-active=\"true\"] .pg { background: rgba(255, 255, 255, .95); color: var(--dpm-a); box-shadow: 0 2px 10px rgba(20, 10, 60, .25); }\n.dpm-entry[data-active=\"true\"] .pgi .b2 { fill: color-mix(in srgb, var(--dpm-a) 45%, transparent); }\n.dpm-entry[data-active=\"true\"] .pgi .drop { opacity: 1; }\nbutton:has(.dpm-entry):hover .pgi .b1 { animation: dpm-eq 560ms var(--ease) both; }\nbutton:has(.dpm-entry):hover .pgi .b2 { animation: dpm-eq 560ms 70ms var(--ease) both; }\nbutton:has(.dpm-entry):hover .pgi .b3 { animation: dpm-eq 560ms 140ms var(--ease) both; }\n@keyframes dpm-eq { 0%, 100% { transform: scaleY(1); } 35% { transform: scaleY(.55); } 70% { transform: scaleY(1.12); } }\n/* 光效层：铺满宿主整行 */\n.dpm-entry .hfx { position: absolute; inset: 0; z-index: 1; border-radius: inherit; pointer-events: none; overflow: hidden; }\n.dpm-entry .hfx .rim { position: absolute; inset: 0; border-radius: 12px; padding: 1.5px; background: conic-gradient(from var(--dpm-rim), transparent 0 62%, var(--dpm-a) 76%, #3fd0ea 86%, transparent 96%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0; }\nbutton:has(.dpm-entry):hover .hfx .rim { animation: dpm-rim 1100ms var(--ease) both; }\n@keyframes dpm-rim { 0% { opacity: 0; --dpm-rim: 0deg; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; --dpm-rim: 360deg; } }\n.dpm-entry .hfx .spot { position: absolute; inset: 0; background: radial-gradient(120px circle at var(--dpm-mx, 50%) var(--dpm-my, 50%), rgba(255, 255, 255, .55), transparent 60%); opacity: 0; transition: opacity 200ms var(--ease); }\nbutton:has(.dpm-entry):hover .hfx .spot { opacity: .55; }\nbutton:has(.dpm-entry[data-active=\"true\"]):hover .hfx .spot { opacity: .28; }\n.dpm-entry .hfx .sheen { position: absolute; top: -20%; bottom: -20%; left: 0; width: 38%; background: linear-gradient(100deg, transparent, rgba(255, 255, 255, .55), transparent); transform: translateX(-120%) skewX(-16deg); opacity: 0; }\nbutton:has(.dpm-entry):hover .hfx .sheen { animation: dpm-sheen 900ms 80ms var(--ease) both; }\n.dpm-entry.fx .hfx .sheen { animation: dpm-sheen 900ms 180ms var(--ease) both; }\n@keyframes dpm-sheen { 0% { opacity: 1; transform: translateX(-120%) skewX(-16deg); } 100% { opacity: 1; transform: translateX(380%) skewX(-16deg); } }\n.dpm-entry .hfx .ripple { position: absolute; left: var(--dpm-rx, 50%); top: var(--dpm-ry, 50%); width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: rgba(255, 255, 255, .55); opacity: 0; }\n.dpm-entry.fx .hfx .ripple { animation: dpm-ripple 650ms var(--ease) both; }\n@keyframes dpm-ripple { 0% { opacity: .7; transform: scale(0); } 100% { opacity: 0; transform: scale(22); } }\n.dpm-entry .pgw::before { content: \"\"; position: absolute; inset: -3px; border-radius: 11px; box-shadow: 0 0 0 2px #ffffff; opacity: 0; pointer-events: none; }\n.dpm-entry.fx .pgw::before { animation: dpm-burst 620ms var(--ease) both; }\n.dpm-entry.fx .pgi .drop { animation: dpm-drop 520ms cubic-bezier(.3, 1.6, .5, 1) both; }\n@keyframes dpm-burst { 0% { opacity: .55; transform: scale(.8); } 100% { opacity: 0; transform: scale(1.75); } }\n@keyframes dpm-drop { 0% { opacity: 0; transform: translateY(-15px) scale(.6); } 60% { opacity: 1; } 100% { opacity: 1; transform: none; } }\n/* 徽标：进行中卡片数 */\n.dpm-entry .hbadge { position: absolute; right: 8px; top: 50%; z-index: 2; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; transform: translateY(-50%); background: color-mix(in srgb, var(--dpm-a) 14%, var(--dsw-alias-bg-layer-1, #ffffff)); color: var(--dpm-ink); font-size: 12px; font-weight: 650; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dpm-a) 22%, transparent); }\n.dpm-entry .hbadge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .75; }\n.dpm-entry[data-active=\"true\"] .hbadge { background: rgba(255, 255, 255, .2); color: #ffffff; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .28); }\n.dpm-entry.fx .hbadge { animation: dpm-pop 520ms 260ms cubic-bezier(.3, 1.6, .5, 1) both; }\n@keyframes dpm-pop { 0% { transform: translateY(-50%) scale(.6); } 100% { transform: translateY(-50%) scale(1); } }\n/* 侧栏收成图标栏（宿主给 18px 槽位）：渐变方块 + 红色数字角标 */\nbutton:has(.dpm-entry.rail) { min-height: 0; margin-block: 0; overflow: visible; background: transparent !important; box-shadow: none !important; }\nbutton:has(.dpm-entry.rail):hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 17, 21, .06)) !important; transform: none; }\n.dpm-entry.rail { position: relative; }\n.dpm-entry.rail .hfx { display: none; }\n.dpm-entry.rail .hbadge { right: -9px; top: -9px; z-index: 3; height: 16px; min-width: 16px; padding: 0 4px; justify-content: center; transform: none; font-size: 11px; background: #e5484d; color: #ffffff; box-shadow: 0 0 0 2px var(--dpm-side); }\n.dpm-entry.rail .hbadge i, .dpm-entry.rail .hbadge .hl { display: none; }\n.dpm-entry.rail.fx .hbadge { animation: none; }\n/* 0.11：侧栏卡片组行的活跃会话数与层级引导线（规则按行 id 由 sidebar.ts 生成，这里只放颜色与动画） */\n:root { --dpm-cnt-bg: #eaf0fd; --dpm-cnt-ink: #2f5fcc; --dpm-guide: rgba(15, 17, 21, .14); }\nbody[data-ds-dark-theme] { --dpm-cnt-bg: #1d2a4a; --dpm-cnt-ink: #8fb0ff; --dpm-guide: rgba(255, 255, 255, .18); }\n@keyframes dpm-cnt-bump { 40% { transform: scale(1.25); } }\n/* 0.12：项目区里宿主隐藏的「还没对话」会话，插件补画的行（尺寸对齐宿主会话行：32px 高、16px 槽、14px 标题） */\n.dpm-blank-w { display: block; }\n.dpm-blank { box-sizing: border-box; display: flex; align-items: center; width: -webkit-fill-available; width: stretch; height: 32px; padding: 0 8px; padding-inline-start: calc(8px + var(--dsh-workspace-indent, 0px)); border: 0; border-radius: var(--dsw-radius-md, 12px); background: transparent; color: var(--dsw-alias-label-secondary, #61666b); font: inherit; text-align: left; cursor: pointer; }\n.dpm-blank:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 17, 21, .06)); color: var(--dsw-alias-label-primary, #0f1115); }\n.dpm-blank:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #2f5fcc); outline-offset: -2px; }\n.dpm-blank-s { width: 16px; height: 20px; flex: none; }\n.dpm-blank-t { flex: 1; min-width: 0; margin: 0 6px 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; }\n.dpm-blank-tag { flex: none; height: 18px; padding: 0 6px; border: 1px dashed var(--dsw-alias-border-l3, rgba(0, 0, 0, .14)); border-radius: 6px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); }\n/* 0.13：补画的空会话行可删除（悬停 / 键盘聚焦时出现删除按钮，「未开始」标签让位） */\n.dpm-blank-w.can-del { position: relative; }\n.dpm-blank-del { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; display: none; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer; }\n.dpm-blank-del svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n.dpm-blank-w.can-del:hover .dpm-blank-del, .dpm-blank-w.can-del:focus-within .dpm-blank-del { display: grid; }\n.dpm-blank-w.can-del:hover .dpm-blank-tag, .dpm-blank-w.can-del:focus-within .dpm-blank-tag { visibility: hidden; }\n.dpm-blank-del:hover { color: #c62828; background: rgba(198, 40, 40, .08); }\nbody[data-ds-dark-theme] .dpm-blank-del:hover { color: #ff8a80; background: rgba(255, 138, 128, .1); }\n.dpm-blank-del:focus-visible { display: grid; outline: 2px solid var(--dsw-alias-state-business-primary, #2f5fcc); outline-offset: -2px; }\n@media (hover: none) { .dpm-blank-w.can-del .dpm-blank-del { display: grid; } .dpm-blank-w.can-del .dpm-blank-tag { visibility: hidden; } }\n.dpm .lsess .ib.sdel:hover { color: #c62828; background: rgba(198, 40, 40, .08); }\nbody[data-ds-dark-theme] .dpm .lsess .ib.sdel:hover { color: #ff8a80; }\n/* 0.13：相关链接标题行「管理类型」+「添加链接」 */\n.dpm .h3-acts { display: inline-flex; align-items: center; gap: 4px; flex: none; }\n/* 0.13：管理类型 */\n.dpm-dialog .ty-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }\n.dpm-dialog .ty-row { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 4px 4px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm-dialog .ty-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }\n.dpm-dialog .ty-row .use { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ty-row .ib.sm { width: 28px; height: 28px; }\n.dpm-dialog .ty-row.editing { padding: 4px; }\n.dpm-dialog .ty-row.editing .fld { flex: 1; min-width: 0; height: 32px; }\n.dpm-dialog .ty-list > .wl-err { list-style: none; }\n.dpm-dialog .ty-add { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dpm-dialog .ty-add .fld { flex: 1; min-width: 0; }\n.dpm-dialog .ty-add .btn { flex: none; }\n@media (prefers-reduced-motion: reduce) {\n  [data-row-key]::after { animation: none !important; }\n  button:has(.dpm-entry), button:has(.dpm-entry):hover { transform: none; }\n  .dpm-entry *, .dpm-entry *::before { animation: none !important; transition: none !important; }\n}\n\n/* ── 0.14：卡片仓库 / 候选仓库 / 类型排序 / 重复链接 ── */\n:is(.dpm, .dpm-dialog) .repo .from { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm .detail .ar-empty { margin: 0; padding: 14px 16px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: 10px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .pk .when { flex: none; align-self: center; margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }\n.dpm-dialog .ar-list { max-height: 232px; }\n.dpm-dialog .ar-sec .btn:disabled { opacity: .5; cursor: default; }\n.dpm-dialog .ty-list { position: relative; }\n.dpm-dialog .ty-row { padding-left: 4px; }\n.dpm-dialog .ty-row .ty-grip { cursor: grab; touch-action: none; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ty-row.lifting { opacity: .45; }\n.dpm-dialog .ty-row.landed { animation: dpm-landed 450ms ease-out; }\n@keyframes dpm-landed { 0% { background: var(--pm-brand-soft); } }\n/* 落点指示线：独立元素，画在两个类型之间的空隙正中，不给类型项描边 */\n.dpm-dialog .drop-line { position: absolute; left: 4px; right: 4px; height: 2px; margin-top: -1px; border-radius: 2px; background: var(--pm-brand); pointer-events: none; list-style: none; }\n.dpm-dialog .drop-line::before, .dpm-dialog .drop-line::after { content: \"\"; position: absolute; top: -3px; width: 8px; height: 8px; box-sizing: border-box; border: 2px solid var(--pm-brand); border-radius: 50%; background: var(--dsw-alias-bg-layer-1); }\n.dpm-dialog .drop-line::before { left: -4px; }\n.dpm-dialog .drop-line::after { right: -4px; }\n.dpm-dialog .drop-line[hidden] { display: none; }\n.dpm-dialog .wl-dup { margin-top: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }\n.dpm-dialog .wl-dup .h { margin: 0 0 6px; font-size: 13px; font-weight: 650; }\n.dpm-dialog .wl-dup dl { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 2px 8px; margin: 0; font-size: 13px; }\n.dpm-dialog .wl-dup dt { color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .wl-dup dd { margin: 0; word-break: break-all; }\n.dpm-dialog .wl-dup .a { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }\n.dpm-dialog #dpmWlOk:disabled { opacity: .5; cursor: default; }\n\n/* ── 0.15 新增仓库弹窗：顶部固定（标题+搜索）/ 候选 2 : 已选 1（各自只滚列表）/ 底部按钮固定 ── */\n.dpm-dialog.ar-dlg { height: min(760px, calc(100vh - 48px)); }\n.dpm-dialog.ar-dlg[open] > form { display: flex; flex-direction: column; height: 100%; }\n.dpm-dialog.ar-dlg .ar-head { flex: none; padding: 20px 20px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dpm-dialog.ar-dlg .ar-head h2 { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.4; }\n.dpm-dialog.ar-dlg .ar-head p { margin: 4px 0 12px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .ar-cand, .dpm-dialog .ar-picked { min-height: 0; display: flex; flex-direction: column; }\n.dpm-dialog .ar-cand { flex: 2 1 0; }\n.dpm-dialog .ar-picked { flex: 1 1 0; border-top: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); }\n.dpm-dialog .ar-h { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 20px 8px; font-size: 14px; font-weight: 650; }\n.dpm-dialog .ar-h .meta { font-weight: 400; }\n.dpm-dialog .ar-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 20px 12px; overscroll-behavior: contain; }\n.dpm-dialog .ar-picked .dlg-f { flex: none; padding: 12px 20px 16px; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dpm-dialog .ar-scroll .ar-list { max-height: none; overflow: visible; margin-top: 0; }\n.dpm-dialog .ar-scroll .pk-list { margin-top: 0; }\n/* 分组标题吸顶：sticky 在组容器内 → 下一组标题把上一组顶走；吸住时底边出阴影、说明收起 */\n.dpm-dialog .ar-grp + .ar-grp { margin-top: 4px; }\n.dpm-dialog .ar-sub { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; margin: 0 -20px; padding: 8px 20px 6px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); transition: box-shadow 160ms var(--ease); }\n.dpm-dialog .ar-sub .meta { font-size: 12px; font-weight: 400; }\n.dpm-dialog .ar-sub.stuck { box-shadow: 0 1px 0 var(--dsw-alias-border-l2), 0 6px 12px -8px rgba(15, 17, 21, .18); }\nbody[data-ds-dark-theme] .dpm-dialog .ar-sub.stuck { box-shadow: 0 1px 0 var(--dsw-alias-border-l2), 0 6px 12px -8px rgba(0, 0, 0, .6); }\n.dpm-dialog .ar-sub.stuck .tail { display: none; }\n.dpm-dialog .ar-jump { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; margin-left: -6px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }\n.dpm-dialog .ar-jump:hover { background: var(--pm-select); color: var(--dsw-alias-label-primary); }\n.dpm-dialog .ar-jump .chev { width: 14px; height: 14px; opacity: 0; transform: rotate(180deg); transition: opacity 160ms var(--ease); }\n.dpm-dialog .ar-sub.stuck .ar-jump .chev { opacity: .7; }\n.dpm-dialog .ar-spy { display: inline-flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }\n.dpm-dialog .ar-spy button { min-height: 26px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; cursor: pointer; transition: background 160ms var(--ease), color 160ms var(--ease); }\n.dpm-dialog .ar-spy button:hover { color: var(--dsw-alias-label-primary); }\n.dpm-dialog .ar-spy button[aria-current=\"true\"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--pm-shadow); }\n.dpm-dialog .ar-spy button:disabled { opacity: .45; cursor: default; }\n.dpm-dialog .pk.flash, .dpm-dialog .rp-row.fresh { animation: dpm-fresh 900ms var(--ease); }\n@keyframes dpm-fresh { 0%, 40% { background: var(--pm-brand-soft); } }\n/* ── 0.15 相关文件：选择文件 / 粘贴路径 ── */\n.dpm .fseg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }\n.dpm .fseg .btn.sm { min-height: 26px; }\n.dpm .fseg .btn.sm:hover { background: var(--dsw-alias-bg-layer-1); }\n.dpm .fp { margin-top: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-module-platform); }\n.dpm .fp label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; }\n.dpm .fp textarea { width: 100%; min-height: 64px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font: 12px/1.6 \"SF Mono\", Menlo, monospace; resize: vertical; outline: 0; }\n.dpm .fp textarea:focus { border-color: var(--pm-brand); }\n.dpm .fp-chk { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 0; padding: 0; list-style: none; }\n.dpm .fp-chk li { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 6px; font-size: 12px; line-height: 1.5; }\n.dpm .fp-chk li svg.i { width: 16px; height: 16px; margin-top: 1px; }\n.dpm .fp-chk .p { min-width: 0; word-break: break-all; font-family: \"SF Mono\", Menlo, monospace; }\n.dpm .fp-chk .why { grid-column: 2; }\n.dpm .fp-chk .ok svg.i, .dpm .fp-chk .ok .why { color: var(--pm-ok); }\n.dpm .fp-chk .bad svg.i, .dpm .fp-chk .bad .why { color: #c62828; }\nbody[data-ds-dark-theme] .dpm .fp-chk .bad svg.i, body[data-ds-dark-theme] .dpm .fp-chk .bad .why { color: #ff8a80; }\n.dpm .fp-chk .skip svg.i, .dpm .fp-chk .skip .why { color: var(--dsw-alias-label-secondary); }\n.dpm .fp-bar { display: flex; align-items: center; gap: 8px; margin-top: 10px; }\n.dpm .note-bar [hidden] { display: none; }\n/* ── 0.15 看板：正在同步 + 首次骨架 ── */\n.dpm .pm-top h1 { display: flex; align-items: center; gap: 10px; }\n.dpm .pm-sync { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; opacity: 0; transition: opacity 200ms var(--ease); pointer-events: none; }\n.dpm .pm-sync.on { opacity: 1; }\n.dpm .pm-sync .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pm-brand); animation: dpm-pulse 1s ease-in-out infinite; }\n@keyframes dpm-pulse { 50% { opacity: .3; } }\n.dpm .skel-lane { padding: 12px; }\n.dpm .skel-h { width: 160px; height: 18px; margin-bottom: 12px; border-radius: 6px; }\n.dpm .skel-row { display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 8px; }\n.dpm .skel { height: 84px; border-radius: 10px; }\n.dpm .skel, .dpm .skel-h { background: linear-gradient(90deg, var(--dsw-alias-bg-module-platform) 0%, var(--pm-select) 50%, var(--dsw-alias-bg-module-platform) 100%) 0 0 / 200% 100%; animation: dpm-shimmer 1.2s linear infinite; }\n@keyframes dpm-shimmer { to { background-position: -200% 0; } }\n\n/* 0.16 落盘项目入口 */\n.dpm .lf-note { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm .lf-note > .i { flex: none; width: 16px; height: 16px; }\n.dpm .lf-note .txt { flex: 1; min-width: 0; line-height: 1.5; }\n.dpm .lf-note b { color: var(--dsw-alias-label-primary); font-weight: 600; }\n.dpm .lf-note code { font-size: 12px; word-break: break-all; }\n.dpm .mem-act { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }\n.dpm .mem-act .hint { flex: 1 1 140px; min-width: 0; margin: 0; font-size: 12px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }\n\n\n\n/* ══ 0.19 会话信息卡（原型 v35）：有关联 = 看板按钮同款浅蓝；未关联 = 中性浅灰 ══ */\n.dpm-sic { --pm-sic-off-bg: #f3f4f6; --pm-sic-off-line: rgba(0, 0, 0, .12); --pm-on-chip: rgba(255, 255, 255, .72); --pm-on-grp: rgba(255, 255, 255, .58); --pm-bad: #c43c3c; --pm-guide: rgba(15, 17, 21, .14); font-size: 13px; line-height: 1.5; padding: 0; overflow: hidden; box-shadow: var(--pm-shadow); transition: box-shadow 240ms var(--ease), border-color 240ms var(--ease); }\nbody[data-ds-dark-theme] .dpm-sic { --pm-sic-off-bg: #29292b; --pm-sic-off-line: rgba(255, 255, 255, .14); --pm-on-chip: rgba(255, 255, 255, .07); --pm-on-grp: rgba(0, 0, 0, .2); --pm-bad: #ff8a8a; --pm-guide: rgba(255, 255, 255, .18); }\n.dpm-sic[hidden] { display: none !important; }\n.dpm-sic.on { background: linear-gradient(135deg, var(--pm-brand-soft) 0%, color-mix(in srgb, var(--pm-brand-soft) 42%, var(--dsw-alias-bg-layer-1)) 100%); border-color: var(--pm-brand-line); }\n.dpm-sic.off { background: var(--pm-sic-off-bg); border-color: var(--pm-sic-off-line); }\n.dpm-sic.open { box-shadow: var(--pm-shadow-2); }\n.dpm-sic button, .dpm-sic input { font: inherit; color: inherit; }\n.dpm-sic button { cursor: pointer; }\n.dpm-sic :focus-visible { outline: 2px solid var(--pm-brand); outline-offset: 2px; border-radius: 8px; }\n.dpm-sic .mono { font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .sic-h { position: relative; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 6px 0 10px; }\n.dpm-sic .sic-h .tgl { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; text-align: left; }\n.dpm-sic .sic-h .tgl:focus-visible { outline-offset: -2px; }\n.dpm-sic .crumb { display: flex; align-items: center; gap: 6px; flex: none; max-width: 38%; min-width: 0; font-size: 13px; font-weight: 650; }\n.dpm-sic .crumb .g { color: var(--dsw-alias-label-secondary); font-weight: 500; white-space: nowrap; }\n.dpm-sic.on .crumb .g { color: color-mix(in srgb, var(--pm-brand) 55%, var(--dsw-alias-label-secondary)); }\n.dpm-sic .crumb .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .crumb .sl { color: var(--dsw-alias-border-l3); }\n.dpm-sic .pills { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; overflow: hidden; }\n.dpm-sic .pill { display: inline-flex; align-items: center; gap: 5px; flex: none; height: 24px; padding: 0 8px; border-radius: 999px; background: var(--pm-on-chip); font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }\n.dpm-sic .pill b { font-weight: 650; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }\n.dpm-sic .pill svg.i { width: 13px; height: 13px; }\n.dpm-sic .pill.mem { background: var(--dsw-alias-bg-layer-1); color: var(--pm-brand); box-shadow: inset 0 0 0 1px var(--pm-brand-line); }\n.dpm-sic .pill.mem b { color: var(--pm-brand); }\n.dpm-sic .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: dpmpulse 1s ease-in-out infinite; }\n@keyframes dpmpulse { 50% { opacity: .25; } }\n.dpm-sic .acts { display: flex; align-items: center; gap: 2px; flex: none; }\n.dpm-sic .ib { position: relative; width: 30px; height: 30px; display: grid; place-items: center; flex: none; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); transition: background 140ms var(--ease), color 140ms var(--ease), transform 120ms var(--ease); }\n.dpm-sic .ib:hover { background: var(--pm-on-chip); color: var(--dsw-alias-label-primary); }\n.dpm-sic .ib:active { transform: scale(.9); }\n.dpm-sic .ib.board svg { width: 15px; height: 15px; fill: currentColor; stroke: none; }\n.dpm-sic .ib.board:hover { color: var(--pm-brand); }\n.dpm-sic .sic-h .chev, .dpm-sic [data-tgl] .chev { transition: transform 260ms var(--ease); }\n.dpm-sic svg.i.chev, .dpm-sic .ib svg.i { transition: transform 260ms var(--ease); }\n/* 0.20：收起时箭头朝上（点了往上展开），展开时朝下 */\n.dpm-sic .acts [data-tgl] svg.i { transform: rotate(180deg); }\n.dpm-sic.open .acts [data-tgl] svg.i { transform: none; }\n.dpm-sic .mk { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; height: 30px; padding: 0 4px 0 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); transition: border-color 160ms var(--ease), box-shadow 160ms var(--ease); }\n.dpm-sic .mk:focus-within { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm-sic .mk input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 13px; }\n.dpm-sic .mk .tok { display: flex; gap: 4px; flex: none; max-width: 45%; overflow: hidden; }\n.dpm-sic .mk .tok span { height: 20px; padding: 0 6px; border-radius: 6px; background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l2); font-size: 11px; line-height: 18px; white-space: nowrap; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .mk .tok span.file { border-color: var(--pm-brand-line); color: var(--pm-brand); }\n.dpm-sic .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; font-weight: 500; white-space: nowrap; transition: background 140ms var(--ease), transform 120ms var(--ease); }\n.dpm-sic .btn:hover { background: var(--dsw-alias-button-floating-hover, var(--pm-select)); }\n.dpm-sic .btn:active { transform: scale(.97); }\n.dpm-sic .btn.pri { background: var(--pm-brand); border-color: var(--pm-brand); color: var(--pm-brand-ink); }\n.dpm-sic .btn.pri:hover { filter: brightness(1.06); background: var(--pm-brand); }\n.dpm-sic .btn.sm { min-height: 26px; padding: 0 8px; font-size: 12px; border-radius: 8px; }\n.dpm-sic .btn:disabled { opacity: .5; cursor: default; transform: none; }\n.dpm-sic .btn svg.i { width: 14px; height: 14px; }\n.dpm-sic .btn.danger { border-color: color-mix(in srgb, var(--pm-bad) 45%, transparent); color: var(--pm-bad); }\n.dpm-sic .btn.danger:hover { background: color-mix(in srgb, var(--pm-bad) 8%, transparent); }\n.dpm-sic .btn.danger.solid { background: var(--pm-bad); border-color: var(--pm-bad); color: #fff; }\n.dpm-sic .btn.danger.ghost { min-height: 22px; padding: 0 6px; border-color: transparent; background: transparent; }\n.dpm-sic .btn.danger.ghost:hover { border-color: color-mix(in srgb, var(--pm-bad) 45%, transparent); }\n.dpm-sic .spin { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dpmrot .7s linear infinite; }\n@keyframes dpmrot { to { transform: rotate(360deg); } }\n.dpm-sic .sic-b { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 320ms var(--ease); }\n.dpm-sic.open .sic-b { grid-template-rows: 1fr; }\n.dpm-sic .sic-b > .in { min-height: 0; overflow: hidden; }\n.dpm-sic .scroll { max-height: min(52vh, 460px); overflow: auto; padding: 2px 10px 10px; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dpm-sic.on .scroll { border-top-color: color-mix(in srgb, var(--pm-brand-line) 70%, transparent); }\n.dpm-sic .grp { margin-top: 10px; border-radius: 12px; background: var(--pm-on-grp); padding: 8px; opacity: 0; transform: translateY(6px); transition: opacity 260ms var(--ease), transform 260ms var(--ease); }\n.dpm-sic.open .grp { opacity: 1; transform: none; }\n.dpm-sic.open .grp + .grp { transition-delay: 70ms; }\n.dpm-sic .grp-h { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 4px 0 6px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .grp-h svg.i { width: 14px; height: 14px; }\n.dpm-sic .grp-h .n { height: 18px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-1); font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; }\n.dpm-sic .sp { flex: 1; }\n.dpm-sic .lnk { border: 0; background: transparent; color: var(--pm-brand); font-size: 12px; font-weight: 500; padding: 2px 4px; border-radius: 6px; }\n.dpm-sic .lnk:hover { background: var(--pm-brand-soft); }\n.dpm-sic .lfs { display: flex; flex-direction: column; gap: 6px; }\n.dpm-sic .lf { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 8px 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); transition: border-color 200ms var(--ease); }\n.dpm-sic .lf .txt { flex: 1; min-width: 0; }\n.dpm-sic .lf .l1 { display: flex; align-items: center; gap: 6px; min-width: 0; }\n.dpm-sic .lf .nm { font-weight: 650; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .lf .pj { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .tag { flex: none; height: 18px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l2); font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }\n.dpm-sic .lf .l2 { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .lf .st { display: inline-flex; align-items: center; gap: 4px; flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }\n.dpm-sic .lf .st svg.i { width: 13px; height: 13px; color: var(--pm-ok); }\n.dpm-sic .lf .st .pend { color: var(--pm-brand); }\n.dpm-sic .lf.busy { border-color: var(--pm-brand-line); background: linear-gradient(90deg, var(--dsw-alias-bg-layer-1) 0%, var(--pm-brand-soft) 50%, var(--dsw-alias-bg-layer-1) 100%); background-size: 200% 100%; animation: dpmshimmer 1.4s linear infinite; }\n@keyframes dpmshimmer { to { background-position: -200% 0; } }\n.dpm-sic .lf.picked { border-color: var(--pm-brand); box-shadow: 0 0 0 1px var(--pm-brand); }\n.dpm-sic .lf.fresh, .dpm-sic .unit.fresh { animation: dpmfresh 1.1s var(--ease); }\n@keyframes dpmfresh { 0%, 40% { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); } }\n.dpm-sic .unit { border: 1px solid var(--pm-brand-line); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }\n.dpm-sic .unit > .lf { border: 0; border-radius: 0; }\n.dpm-sic .dn { border-top: 1px dashed var(--pm-brand-line); }\n.dpm-sic .dn-h { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 6px 0 10px; border: 0; background: color-mix(in srgb, var(--pm-brand-soft) 60%, transparent); font-size: 12.5px; text-align: left; transition: background 140ms var(--ease); }\n.dpm-sic .dn-h:hover { background: var(--pm-brand-soft); }\n.dpm-sic .dn-h:focus-visible { outline-offset: -2px; }\n.dpm-sic .dn-h b { font-weight: 650; }\n.dpm-sic .dn-h .okc { width: 16px; height: 16px; flex: none; border-radius: 50%; background: var(--pm-ok); color: #fff; display: grid; place-items: center; }\n.dpm-sic .dn-h .okc svg { width: 10px; height: 10px; stroke-width: 3; }\n.dpm-sic .dn-h .dn-m { color: var(--dsw-alias-label-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }\n.dpm-sic .dn-h > svg.i:last-child { transition: transform 260ms var(--ease); }\n.dpm-sic .dn.open .dn-h > svg.i:last-child { transform: rotate(180deg); }\n.dpm-sic .dn-b { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 280ms var(--ease); }\n.dpm-sic .dn.open .dn-b { grid-template-rows: 1fr; }\n.dpm-sic .dn-b > .in { min-height: 0; overflow: hidden; }\n.dpm-sic .dn-body { padding: 4px 10px 10px; }\n.dpm-sic .sub { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .ft { display: flex; align-items: center; gap: 8px; margin-top: 10px; }\n.dpm-sic .ft .meta { flex: 1; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .res { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 8px 0; }\n.dpm-sic .res div { padding: 8px; border-radius: 8px; background: var(--pm-lane); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .res b { display: block; font-size: 16px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }\n.dpm-sic .old { margin: 6px 0 0; padding: 4px; border-radius: 8px; background: var(--pm-lane); }\n.dpm-sic .old-t { margin: 2px 4px 4px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .orow { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto auto auto; align-items: center; gap: 8px; min-height: 30px; padding: 3px 6px 3px 2px; border-radius: 6px; font-size: 12.5px; }\n.dpm-sic .orow:hover { background: var(--dsw-alias-bg-layer-1); }\n.dpm-sic .orow.gone { opacity: .6; }\n.dpm-sic .orow .p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .orow .p b { font-weight: 600; }\n.dpm-sic .orow .p span { color: var(--dsw-alias-label-secondary); margin-left: 6px; }\n.dpm-sic .orow .m { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }\n.dpm-sic .orow .ib { width: 24px; height: 24px; }\n.dpm-sic .orow .ib.cp { opacity: 0; }\n.dpm-sic .orow:hover .ib.cp, .dpm-sic .orow .ib.cp:focus-visible, .dpm-sic .ib.cp.copied { opacity: 1; }\n.dpm-sic .ib.xp { width: 20px; height: 20px; }\n.dpm-sic .ib.xp[aria-expanded=\"false\"] svg.i { transform: rotate(-90deg); }\n.dpm-sic .xp-sp { width: 20px; }\n.dpm-sic .nest { margin: 0 0 2px 11px; padding-left: 8px; border-left: 1px solid var(--pm-guide); }\n.dpm-sic .ask { margin-top: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--pm-bad) 35%, transparent); background: color-mix(in srgb, var(--pm-bad) 5%, transparent); font-size: 12px; line-height: 1.6; animation: dpmpop 200ms var(--ease); }\n.dpm-sic .ask .ft { margin-top: 6px; }\n.dpm-sic .ask.in-row { margin: 4px 0 6px 22px; }\n.dpm-sic .mg { margin-top: 8px; padding: 10px; border-radius: 10px; border: 1px solid var(--pm-brand-line); background: var(--dsw-alias-bg-layer-1); animation: dpmpop 260ms var(--ease); }\n@keyframes dpmpop { from { opacity: 0; transform: translateY(-4px) scale(.99); } }\n.dpm-sic .mg h4 { margin: 0 0 6px; font-size: 13px; }\n.dpm-sic .srcs-h { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; padding: 0 2px 0 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n.dpm-sic .srcs { display: flex; flex-direction: column; gap: 2px; }\n.dpm-sic .src { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 8px; font-size: 12.5px; cursor: pointer; }\n.dpm-sic .src:hover { background: var(--pm-lane); }\n.dpm-sic .src input { margin: 0; accent-color: var(--pm-brand); }\n.dpm-sic .src .p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .src .m { font-size: 11.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }\n.dpm-sic .tgt { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 10px; align-items: center; margin: 10px 0 8px; font-size: 12.5px; }\n.dpm-sic .tgt label { color: var(--dsw-alias-label-secondary); }\n.dpm-sic .tgt .fld { display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; }\n.dpm-sic .tgt .fld input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: 12px ui-monospace, Menlo, monospace; }\n.dpm-sic .tgt .fld:focus-within { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm-sic .tgt .als { display: flex; flex-wrap: wrap; gap: 4px; }\n.dpm-sic .tgt .als span { height: 20px; padding: 0 6px; border-radius: 6px; background: var(--pm-lane); font: 11px/20px ui-monospace, Menlo, monospace; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .tgt .als span.none { background: transparent; padding: 0; }\n.dpm-sic .warn { margin: 0 0 8px; font-size: 12px; color: var(--pm-bad); }\n.dpm-sic .warn[hidden] { display: none; }\n.dpm-sic .warn-t { color: var(--pm-bad); }\n.dpm-sic .plan { margin: 0; padding: 8px 10px 8px 26px; border-radius: 8px; background: var(--pm-lane); font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .plan b { color: var(--dsw-alias-label-primary); font-weight: 600; }\n.dpm-sic .tl { margin: 4px 0 0; padding: 0; list-style: none; }\n.dpm-sic .tl li { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 4px 0 8px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .tl li::before { content: \"\"; position: absolute; left: 7px; top: 22px; bottom: -2px; width: 2px; background: var(--dsw-alias-border-l2); }\n.dpm-sic .tl li:last-child::before { display: none; }\n.dpm-sic .tl .nd { position: relative; z-index: 1; width: 16px; height: 16px; flex: none; margin-top: 1px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); display: grid; place-items: center; transition: all 240ms var(--ease); }\n.dpm-sic .tl li.on { color: var(--dsw-alias-label-primary); }\n.dpm-sic .tl li.on .nd { border-color: var(--pm-brand); box-shadow: 0 0 0 4px var(--pm-brand-soft); }\n.dpm-sic .tl li.ok .nd { border-color: var(--pm-ok); background: var(--pm-ok); color: #fff; }\n.dpm-sic .tl li.ok .nd svg { width: 10px; height: 10px; stroke-width: 3; }\n.dpm-sic .tl li.ok::before { background: var(--pm-ok); }\n.dpm-sic .tl .bar { height: 4px; margin-top: 5px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); overflow: hidden; }\n.dpm-sic .tl .bar i { display: block; height: 100%; background: var(--pm-brand); transition: width 300ms var(--ease); }\n.dpm-sic .fx { margin: 8px 0 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }\n.dpm-sic .fx summary { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 10px; cursor: pointer; list-style: none; font-size: 12.5px; border-radius: 8px; }\n.dpm-sic .fx summary::-webkit-details-marker { display: none; }\n.dpm-sic .fx summary:hover { background: var(--pm-lane); }\n.dpm-sic .fx summary .fm { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .fx summary svg.i { width: 14px; height: 14px; transform: rotate(-90deg); transition: transform 200ms var(--ease); }\n.dpm-sic .fx[open] summary svg.i { transform: none; }\n.dpm-sic .fx-b { padding: 2px 10px 8px; }\n.dpm-sic .fr { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 8px; align-items: start; padding: 5px 0; border-top: 1px dashed var(--dsw-alias-border-l2); font-size: 12px; }\n.dpm-sic .fr:first-child { border-top: 0; }\n.dpm-sic .fk { color: var(--dsw-alias-label-secondary); font-weight: 600; line-height: 20px; }\n.dpm-sic .fv { display: flex; flex-direction: column; gap: 2px; min-width: 0; }\n.dpm-sic .fv code, .dpm-sic .fl .fp { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11.5px/20px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-primary); }\n.dpm-sic .fs { color: var(--dsw-alias-label-secondary); line-height: 18px; }\n.dpm-sic .fr .ib { width: 24px; height: 24px; }\n.dpm-sic .fl { margin: 0 0 4px 72px; padding: 0; list-style: none; }\n.dpm-sic .fl li { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 8px; padding: 1px 0; font-size: 11.5px; }\n.dpm-sic .fl .ff { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); line-height: 20px; }\n.dpm-sic .ma { padding: 2px 4px 4px; }\n.dpm-sic .ma-s + .ma-s { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--dsw-alias-border-l2); }\n.dpm-sic .ma-t { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; padding-left: 2px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .ma-t svg.i { width: 13px; height: 13px; }\n.dpm-sic .ma-t .c { font-weight: 500; font-variant-numeric: tabular-nums; }\n.dpm-sic .row { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 3px 4px 3px 6px; border-radius: 8px; font-size: 13px; transition: background 140ms var(--ease); }\n.dpm-sic .row:hover { background: var(--dsw-alias-bg-layer-1); }\n.dpm-sic .row.gone .v { text-decoration: line-through; }\n.dpm-sic .row .k { flex: none; width: 108px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .row .v { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .row .v.pri { color: var(--dsw-alias-label-primary); }\n.dpm-sic .row .ty { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 0 6px; height: 18px; line-height: 18px; border-radius: 5px; background: var(--dsw-alias-bg-module-platform); }\n.dpm-sic .row .ib { width: 26px; height: 26px; opacity: 0; }\n.dpm-sic .row:hover .ib, .dpm-sic .row .ib:focus-visible, .dpm-sic .row .ib.copied { opacity: 1; }\n.dpm-sic .task .bx { width: 14px; height: 14px; flex: none; border: 1.5px solid var(--dsw-alias-border-l3); border-radius: 4px; display: grid; place-items: center; }\n.dpm-sic .task .bx svg.i { width: 10px; height: 10px; stroke-width: 3; }\n.dpm-sic .task.dn .bx { background: var(--pm-ok); border-color: var(--pm-ok); color: #fff; }\n.dpm-sic .task.dn .v { text-decoration: line-through; }\n.dpm-sic .note { margin: 0 2px; padding: 6px 8px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; max-height: 160px; overflow: auto; }\n.dpm-sic .empty { margin: 0; padding: 2px 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n\n/* 复制按钮（与 dsh-manage-sessions 一致：图标 → 对勾，1.2s 复原） */\n:is(.dpm-sic, .dpm) .cp svg { width: 15px; height: 15px; transition: opacity .16s ease, transform .16s ease; }\n:is(.dpm-sic, .dpm) .cp .cp-ck { position: absolute; inset: 0; margin: auto; opacity: 0; transform: scale(.55); color: var(--pm-ok); }\n:is(.dpm-sic, .dpm) .cp.copied .cp-ico { opacity: 0; transform: scale(.55); }\n:is(.dpm-sic, .dpm) .cp.copied .cp-ck { opacity: 1; transform: scale(1); }\n.dpm .wl .cp { position: relative; }\n\n/* 悬停走马灯：只在文字被截断且鼠标悬停时跑 */\n.mq-on { text-overflow: clip !important; }\n.mq-track { display: inline-block; white-space: nowrap; animation: dpmmq var(--mq-dur, 8s) linear infinite; }\n.mq-track > span { padding-right: 40px; }\n@keyframes dpmmq { from { transform: translateX(0); } to { transform: translateX(-50%); } }\n\n/* 看板直达：卡片闪一下蓝框 */\n.dpm .card.dpm-flash { animation: dpmflash 1.2s var(--ease); }\n@keyframes dpmflash { 0%, 35% { box-shadow: 0 0 0 4px var(--pm-brand-soft), 0 0 0 1px var(--pm-brand); } }\n\n/* 「AI 收到的原文」浮层 */\n.dpm-ov { position: fixed; inset: 0; z-index: 1500; display: grid; place-items: center; padding: 24px; background: rgba(15, 17, 21, .32); animation: dpmfade 160ms ease; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.5;\n  --pm-brand: #2f5fcc; --pm-lane: #f7f8fa; --pm-shadow-2: 0 8px 28px rgba(15, 17, 21, .12); --ease: cubic-bezier(.2, .8, .2, 1); }\nbody[data-ds-dark-theme] .dpm-ov { background: rgba(0, 0, 0, .55); --pm-brand: #6c97ff; --pm-lane: #1c1c1e; --pm-shadow-2: 0 12px 32px rgba(0, 0, 0, .5); }\n.dpm-ov * { box-sizing: border-box; }\n.dpm-ov.out { opacity: 0; transition: opacity 160ms ease; }\n@keyframes dpmfade { from { opacity: 0; } }\n.dpm-ov button { font: inherit; color: inherit; cursor: pointer; }\n.dpm-ov :focus-visible { outline: 2px solid var(--pm-brand); outline-offset: 2px; border-radius: 8px; }\n.dpm-ov svg.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n.dpm-ov .dlg { width: min(780px, 100%); max-height: min(84vh, 760px); display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: var(--pm-shadow-2); animation: dpmpop 220ms var(--ease); }\n.dpm-ov .dlg-h { display: flex; align-items: flex-start; gap: 10px; padding: 16px 12px 10px 20px; }\n.dpm-ov .dlg-h h2 { margin: 0; font-size: 15px; }\n.dpm-ov .dlg-h p { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-ov .ib { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); }\n.dpm-ov .ib:hover { background: var(--pm-lane); color: var(--dsw-alias-label-primary); }\n.dpm-ov .tabs { display: flex; gap: 16px; padding: 0 20px; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dpm-ov .tabs button { height: 40px; margin-bottom: -1px; padding: 0 2px; border: 0; border-bottom: 2px solid transparent; background: transparent; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n.dpm-ov .tabs button[aria-selected=\"true\"] { color: var(--dsw-alias-label-primary); font-weight: 650; border-bottom-color: var(--pm-brand); }\n.dpm-ov .tabs .c { margin-left: 6px; font-size: 11.5px; font-weight: 400; color: var(--dsw-alias-label-secondary); }\n.dpm-ov .dlg-b { flex: 1; min-height: 0; overflow: auto; padding: 12px 20px 16px; }\n.dpm-ov .hint { margin: 0 0 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-ov .raw { margin: 0; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--pm-lane); font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-primary); white-space: pre-wrap; word-break: break-word; }\n.dpm-ov .inj { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }\n.dpm-ov .inj + .inj { margin-top: 8px; }\n.dpm-ov .inj summary { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 12px; cursor: pointer; list-style: none; font-size: 13px; border-radius: 10px; }\n.dpm-ov .inj summary::-webkit-details-marker { display: none; }\n.dpm-ov .inj summary:hover { background: var(--pm-lane); }\n.dpm-ov .inj summary b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }\n.dpm-ov .inj summary .sp { flex: 1; }\n.dpm-ov .inj summary .m { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n.dpm-ov .inj summary .tag { flex: none; height: 18px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l2); font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }\n.dpm-ov .inj summary svg.i { transform: rotate(-90deg); transition: transform 200ms var(--ease); }\n.dpm-ov .inj[open] summary svg.i { transform: none; }\n.dpm-ov .inj .raw { margin: 0 10px 10px; max-height: 50vh; overflow: auto; }\n.dpm-ov .dlg-f { display: flex; align-items: center; gap: 8px; padding: 10px 16px 14px 20px; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dpm-ov .dlg-f .meta { flex: 1; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n.dpm-ov .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; }\n.dpm-ov .btn:hover { background: var(--pm-lane); }\n@media (prefers-reduced-motion: reduce) { .dpm-sic *, .dpm-sic, .dpm-ov, .dpm-ov * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; } .mq-track { animation: none !important; } }\n.dpm-sic .plan li { display: list-item; font-size: 12px; line-height: 1.7; }\n.dpm-sic .plan li b { flex: initial; }\n/* 宿主的输入区是 flex 列：卡片不许被压扁（收起实测被压到 13px） */\n.dpm-sic { flex: none; min-height: 40px; }\n.dpm-sic .scroll { max-height: min(46vh, 440px); }\n\n/* ══ 0.20 会话信息卡：落盘这一轮的结局 / 同名检测 / 卡片组落盘文件夹 / 迁移 ══ */\n.dpm-sic .pill.bad { color: var(--pm-bad); background: color-mix(in srgb, var(--pm-bad) 8%, var(--dsw-alias-bg-layer-1)); }\n.dpm-sic .lf.stopped { border-color: color-mix(in srgb, var(--pm-bad) 40%, transparent); }\n.dpm-sic .lf .l2.bad { color: var(--pm-bad); }\n.dpm-sic .lf .st.stop, .dpm-sic .lf .st.stop svg.i { color: var(--pm-bad); }\n.dpm-sic .lf .st.wait, .dpm-sic .lf .st.wait svg.i { color: var(--pm-brand); }\n.dpm-sic .tag.legacy { border-color: color-mix(in srgb, var(--pm-bad) 40%, transparent); color: var(--pm-bad); }\n.dpm-sic .hint-l { display: flex; align-items: center; gap: 6px; min-height: 28px; margin: 0 8px 6px; padding: 0 8px; border-radius: 8px; background: var(--pm-on-grp); font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .hint-l .em { flex: none; color: var(--pm-bad); font-weight: 600; }\n.dpm-sic .hint-l .mq { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .mk.dup { border-color: var(--pm-brand); }\n.dpm-sic .mk .tok span.dup { border-color: var(--pm-brand); background: var(--pm-brand-soft); color: var(--pm-brand); }\n.dpm-sic .mk input:disabled { opacity: .6; }\n.dpm-sic .mt { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 260ms var(--ease); }\n.dpm-sic .mt.on { grid-template-rows: 1fr; }\n.dpm-sic .mt > .in { min-height: 0; overflow: hidden; }\n.dpm-sic .mt-b { margin: 0 8px 8px; padding: 8px; border-radius: 10px; background: var(--pm-on-grp); }\n.dpm-sic .mt-t { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; padding: 0 2px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .mt-t .why { font-weight: 400; }\n.dpm-sic .cand { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 10px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }\n.dpm-sic .cand + .cand { margin-top: 6px; }\n.dpm-sic .cand.exact { border-color: var(--pm-brand); box-shadow: 0 0 0 1px var(--pm-brand); }\n.dpm-sic .cand .txt { flex: 1; min-width: 0; }\n.dpm-sic .cand .l1 { display: flex; align-items: center; gap: 6px; min-width: 0; }\n.dpm-sic .cand .nm { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .cand .nm mark { background: color-mix(in srgb, var(--pm-brand) 18%, transparent); color: inherit; border-radius: 3px; }\n.dpm-sic .cand .pj { flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .cand .tag { max-width: 40%; overflow: hidden; text-overflow: ellipsis; }\n.dpm-sic .cand .l2 { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dpm-sic .cand .l3 { margin-top: 3px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .cand .l3 b { font-weight: 600; color: var(--dsw-alias-label-primary); }\n.dpm-sic .cacts { display: flex; gap: 6px; flex: none; }\n.dpm-sic .mt-f { margin: 6px 2px 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .mt-f .lnk { text-decoration: underline; text-underline-offset: 2px; }\n.dpm-sic .fo { margin: 0 8px 8px; padding: 10px; border-radius: 10px; border: 1px solid var(--pm-brand-line); background: var(--dsw-alias-bg-layer-1); animation: dpmpop 220ms var(--ease); }\n.dpm-sic .fo-t { margin: 0; font-size: 13px; font-weight: 650; }\n.dpm-sic .fo-s { margin: 2px 0 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dpm-sic .fo-r { display: flex; align-items: center; gap: 6px; }\n.dpm-sic .fo-r .fld { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; height: 30px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }\n.dpm-sic .fo-r .fld:focus-within { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm-sic .fo-r .pre { color: var(--dsw-alias-label-secondary); }\n.dpm-sic .fo-r input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; }\n.dpm-sic .fo-e { margin: 4px 0 0; font-size: 12px; color: var(--pm-bad); }\n.dpm-sic .fo-e:empty { display: none; }\n\n/* ══ 0.20 卡片组标题旁统计：卡片数醒目（0 张变灰）+ 活跃会话实时 ══ */\n/* 统计一行不折：窄的时候先省略灰色小字、再省略统计，组名最后才截断 */\n.dpm .gstat { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: nowrap; overflow: hidden; }\n.dpm .gstat .cnt { flex: none; }\n/* 卡片数与活跃会话胶囊不压缩；泳道窄（详情打开时）先藏仓库 / 阶段小字，再截断组名 */\n.dpm .lane-h { container-type: inline-size; }\n@media (min-width: 721px) { .dpm .lane-hit .gstat { flex: none; } .dpm .lane-hit h2 { flex: 0 1 auto; min-width: 4em; } }\n@container (max-width: 1000px) { .dpm .gstat .quiet { display: none; } }\n@container (max-width: 820px) { .dpm .lane-hit .lb { display: none; } }\n.dpm .gstat .cnt { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; transition: background 200ms var(--ease), color 200ms var(--ease); }\n.dpm .gstat .cnt b { font-size: 13px; font-weight: 700; }\n.dpm .gstat .cnt.cards { background: var(--pm-brand); color: var(--pm-brand-ink, #fff); }\n.dpm .gstat .cnt.cards.zero { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); opacity: .75; }\n.dpm .gstat .cnt.live { background: var(--dsw-alias-bg-layer-1); color: var(--pm-ok, #1f7a4d); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pm-ok, #1f7a4d) 35%, transparent); }\n.dpm .gstat .cnt.live i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }\n.dpm .gstat .cnt.live.zero { color: var(--dsw-alias-label-secondary); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); opacity: .75; }\n.dpm .gstat .cnt.live.zero i { background: transparent; border: 1.5px solid currentColor; box-sizing: border-box; }\n.dpm .gstat .cnt.bump { animation: dpm-cnt-bump 420ms cubic-bezier(.2, .8, .2, 1); }\n.dpm .gstat .quiet { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }\n@keyframes dpm-cnt-bump { 40% { transform: scale(1.14); } }\n/* 0.20 新建会话忙态 */\n:is(.dpm, .dpm-dialog) .btn .spin { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dpmrot .7s linear infinite; }\n:is(.dpm, .dpm-dialog) .btn[aria-busy=\"true\"] { opacity: .75; cursor: progress; }\n/* 0.20 卡片组设置：落盘文件夹 */\n.dpm-dialog .lf-fld { display: flex; align-items: center; gap: 2px; height: 36px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--dsw-alias-bg-layer-1); }\n.dpm-dialog .lf-fld:focus-within { border-color: var(--pm-brand); box-shadow: 0 0 0 3px var(--pm-brand-soft); }\n.dpm-dialog .lf-fld .pre { color: var(--dsw-alias-label-secondary); }\n.dpm-dialog .lf-fld input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; color: inherit; }\n\n/* 0.20 侧栏：当前打开的空会话由插件画（选中底色同宿主），新建中的占位行 */\n.dpm-blank.cur { background: var(--dsw-alias-interactive-bg-selected, rgba(15, 17, 21, .08)); color: var(--dsw-alias-label-primary, #0f1115); font-weight: 600; }\n.dpm-blank.pend { cursor: progress; opacity: .8; }\n.dpm-blank.pend .dpm-blank-s { position: relative; }\n.dpm-blank.pend .dpm-blank-s::after { content: \"\"; position: absolute; left: 3px; top: 5px; width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dpmrot .7s linear infinite; box-sizing: border-box; }\n";
		//#endregion
		//#region src/client/entry.ts
		/**
		* 全局面板「项目看板」主按钮的图标块（原型 v15-panel2）。
		* 行（button）由宿主 dsh-client-ui-sidebar 画，插件经 sidebar.panellist 只给图标组件：
		*  - .dpm-entry 本身是行内的图标块；整行渐变 / 浮起 / 选中态由 style.css 里 button:has(.dpm-entry) 规则给宿主行加（非公开选择器，失效 = 普通图标行）；
		*  - 光效层（流光边框 / 跟随光晕 / 高光 / 波纹）与「N 进行中」徽标从图标块里绝对定位铺满整行（宿主行由同一条 CSS 设为 position:relative）。
		* 动效只在状态变化时播一次（悬停 / 点击 / 进入看板），不循环；prefers-reduced-motion 下全部关闭。
		*/
		/** 0.19 进行中 = 没归档、且至少有 1 个没归档会话（不算子代理；会话已删除的不算）的卡片。live(id) = 会话存在且没归档。 */
		function doingCount(b, live) {
			const busy = new Set(b.sessions.filter((s) => live(s.sessionId)).map((s) => s.cardId));
			return b.cards.filter((c) => !c.archivedAt && busy.has(c.id)).length;
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
				title: p.count + " 张卡片进行中。进行中 = 没归档、且至少有 1 个没归档会话的卡片（会话归档 / 恢复、卡片归档 / 恢复后立刻刷新）"
			}, (0, react.createElement)("i"), String(p.count), (0, react.createElement)("span", { className: "hl" }, " 进行中")) : null, (0, react.createElement)("span", { className: "pgw" }, (0, react.createElement)("span", {
				className: "pg",
				dangerouslySetInnerHTML: { __html: GLYPH }
			})));
		}
		//#endregion
		//#region src/client/dock.ts
		/**
		* 0.19 会话信息卡（原型 v35 定稿）：会话输入框上方一张卡片。
		* - 收起：一行（组 / 卡片 + 数字胶囊 + 看板直达 + 展开）；展开：「落盘项目」「卡片资料」两组。
		* - 落盘项目：每个一行（单个落盘按钮）；多于 1 个可「合并」（勾选、默认全选），合并结果和它自己的「合并完成」卡片包成一个单元，
		*   合并前的落盘项目按层级列出，可撤销（只退一步）/ 删除（连同更早合并的）/ 单独删除更早合并的。
		* - 没关联：第一行是「新建落盘项目」输入框。
		* - 「查看 AI 收到的原文」：系统提示里本卡片那一段 + 注入会话的全文（与插件发给 AI 的逐字一致）。
		* 数据来自 GET session（与喂给 AI 的同一份看板 / 磁盘数据）。DOM 全部挂在 root 上，dispose 即净。
		*/
		const OPEN = /* @__PURE__ */ new Map();
		const wan = (n) => n >= 1e4 ? (n / 1e4).toFixed(1).replace(/\.0$/, "") + " 万字" : n + " 字";
		const pj = (k) => k.split("/")[0];
		const nm = (k) => k.split("/")[1] ?? k;
		const home = (p) => p.replace(/^\/Users\/[^/]+\//, "~/").replace(/^\/home\/[^/]+\//, "~/");
		/** 合并时间（本地时区）：10-13 21:02 */
		const when = (iso) => {
			const d = new Date(iso);
			return Number.isNaN(d.getTime()) ? iso : String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
		};
		const tok = (s) => Math.round(s.length * .55);
		const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
		const copyBtn = (v, what) => "<button type=\"button\" class=\"ib cp\" data-copy=\"" + esc(v) + "\" data-what=\"" + esc(what) + "\" aria-label=\"复制" + esc(what) + "\" title=\"复制" + esc(what) + "\"><svg class=\"cp-ico\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z\" fill=\"currentColor\"/></svg><svg class=\"cp-ck\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z\" fill=\"currentColor\"/></svg></button>";
		/** 新建落盘项目：第一个不含中文的名字当文件名（小写，非法字符换成 -），其余都是别名。 */
		function parseNames(v) {
			const names = v.split(/\s+/).map((x) => x.trim()).filter(Boolean);
			const raw = names.find((n) => !/[\u4e00-\u9fff]/.test(n));
			return {
				file: raw ? raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 80) || null : null,
				aliases: names.filter((n) => n !== raw)
			};
		}
		/** 只滚会话信息卡自己的滚动区，不碰宿主页面（scrollIntoView 会连外层 overflow:hidden 容器一起滚，整页被顶上去）。 */
		function reveal(el) {
			const box = el?.closest(".scroll");
			if (!el || !box) return;
			const b = box.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			if (r.top < b.top) box.scrollTo({
				top: box.scrollTop + r.top - b.top - 8,
				behavior: "smooth"
			});
			else if (r.bottom > b.bottom) box.scrollTo({
				top: box.scrollTop + Math.min(r.top - b.top - 8, r.bottom - b.bottom + 8),
				behavior: "smooth"
			});
		}
		var SessionCard = class {
			root;
			sid;
			host;
			info = null;
			sig = "";
			timer = 0;
			dead = false;
			mg = null;
			pvTimer = 0;
			/** 刚点了落盘、服务端还没登记好这一轮（发送中）。 */
			sending = null;
			/** 0.20 同名检测结果（输入框内容 → 候选）。 */
			mt = {
				q: "\0",
				r: null,
				seq: 0
			};
			mtTimer = 0;
			/** 0.20 等用户确认卡片组落盘文件夹的动作（确认后继续）。 */
			ask0 = null;
			lastRun = "";
			fresh = "";
			fold = /* @__PURE__ */ new Map();
			shut = /* @__PURE__ */ new Map();
			ask = /* @__PURE__ */ new Set();
			busy = /* @__PURE__ */ new Set();
			wasMerging = "";
			ov = null;
			rawTab = "sys";
			constructor(root, sid, host) {
				this.root = root;
				this.sid = sid;
				this.host = host;
				root.className = "dpm-dock dpm-sic";
				root.hidden = true;
				root.addEventListener("click", this.onClick);
				root.addEventListener("change", this.onChange);
				root.addEventListener("input", this.onInput);
				root.addEventListener("keydown", this.onKey);
				this.load();
				this.timer = window.setInterval(() => {
					if (!document.hidden) this.load();
				}, 4e3);
			}
			dispose() {
				this.dead = true;
				clearInterval(this.timer);
				clearTimeout(this.pvTimer);
				clearTimeout(this.mtTimer);
				this.closeRaw();
				this.root.removeEventListener("click", this.onClick);
				this.root.removeEventListener("change", this.onChange);
				this.root.removeEventListener("input", this.onInput);
				this.root.removeEventListener("keydown", this.onKey);
				this.root.innerHTML = "";
			}
			get open() {
				return OPEN.get(this.sid) ?? false;
			}
			set open(v) {
				OPEN.set(this.sid, v);
			}
			async load(force = false) {
				let r;
				try {
					r = await getSession(this.sid);
				} catch {
					return;
				}
				if (this.dead) return;
				const sig = JSON.stringify(r);
				if (!force && sig === this.sig) return;
				const prev = this.info;
				this.info = r;
				this.sig = sig;
				const run = r.merging?.id ?? "";
				if (this.wasMerging && !run) {
					const res = (r.memDetail ?? []).find((m) => m.merge && m.merge.id === this.wasMerging);
					if (res) {
						this.fresh = res.key;
						this.host.toast("合并完成：" + res.merge.srcs.length + " 个落盘项目合成 " + res.key);
						this.foldOthers(res.merge.id);
					}
				}
				this.wasMerging = run;
				const lr = r.lfRun ?? null;
				const rs = lr ? lr.state + lr.at : "";
				if (lr && rs !== this.lastRun) {
					if (lr.state === "done") {
						this.fresh = lr.key;
						this.host.toast("落盘完成：" + lr.key);
						post("lf/run-dismiss", { sessionId: this.sid }).catch(() => void 0);
					} else if (lr.state === "stopped") this.host.toast("落盘被停止：" + (lr.key || lr.label) + " 没写入", "err");
					else if (lr.state === "error") this.host.toast("落盘出错停止：" + (lr.error ?? ""), "err");
				}
				this.lastRun = rs;
				const a = document.activeElement;
				if (prev && a && this.root.contains(a) && a.matches("input[type=text], input:not([type])")) {
					this.fillMg();
					this.fillMt();
					return;
				}
				this.render();
			}
			foldOthers(keep) {
				for (const m of this.info?.memDetail ?? []) if (m.merge && m.merge.id !== keep) this.fold.set(m.merge.id, true);
				this.fold.set(keep, false);
			}
			render() {
				const i = this.info;
				if (!i?.card || !i.cardInfo) {
					this.root.hidden = true;
					this.root.innerHTML = "";
					return;
				}
				this.root.hidden = false;
				const scroll = this.root.querySelector(".scroll")?.scrollTop ?? 0;
				const ci = i.cardInfo;
				const mem = i.memDetail ?? [];
				const memN = mem.length;
				const matN = ci.repos.length + ci.links.length + ci.files.length + ci.tasks.length + (ci.notes.trim() ? 1 : 0);
				const pend = mem.reduce((n, m) => n + (m.merge?.all ?? 0), 0);
				const crumb = "<span class=\"crumb\" title=\"" + esc(i.card.group + " / " + i.card.title) + "\"><span class=\"g\">" + esc(i.card.group) + "</span><span class=\"sl\">/</span><span class=\"t\">" + esc(i.card.title) + "</span></span>";
				const chev = "<button type=\"button\" class=\"ib\" data-tgl aria-label=\"" + (this.open ? "收起" : "展开") + "会话信息\" title=\"" + (this.open ? "收起" : "展开") + "\" aria-expanded=\"" + this.open + "\">" + ic("chev") + "</button>";
				let head;
				if (!memN) {
					const run = i.lfRun && !i.lfRun.key ? i.lfRun : null;
					const busy = !!this.sending || run?.state === "busy" || run?.state === "ask";
					head = "<div class=\"sic-h\">" + crumb + "<div class=\"mk\" id=\"dpmMk\"><input id=\"dpmMkIn\" type=\"text\" placeholder=\"新建落盘项目：输入名字，空格分隔，留空由 AI 起名\" aria-label=\"新建落盘项目的名字（空格分隔；第一个不含中文的当文件名，其余是别名）\" autocomplete=\"off\" spellcheck=\"false\"" + (busy ? " disabled" : "") + "><span class=\"tok\" id=\"dpmMkTok\"></span></div><span id=\"dpmMkBtn\">" + this.mkBtn(run, busy) + "</span><span class=\"acts\"><button type=\"button\" class=\"ib board\" data-board aria-label=\"在项目看板打开这张卡片\" title=\"在项目看板打开这张卡片\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3.5\" y=\"4\" width=\"4.5\" height=\"15\" rx=\"2.25\"/><rect x=\"9.75\" y=\"4\" width=\"4.5\" height=\"9.5\" rx=\"2.25\"/><rect x=\"16\" y=\"4\" width=\"4.5\" height=\"12.5\" rx=\"2.25\"/></svg></button>" + chev + "</span></div>" + this.runLine(run) + this.folderHtml() + "<div class=\"mt\" id=\"dpmMt\"><div class=\"in\" id=\"dpmMtIn\"></div></div>";
				} else {
					const lr = i.lfRun && i.lfRun.key ? i.lfRun : null;
					const pills = "<span class=\"pill mem\">" + ic("mem") + "落盘项目 <b>" + memN + "</b></span>" + (lr?.state === "busy" || this.sending && this.sending !== "__new" ? "<span class=\"pill mem\"><span class=\"dot\"></span>落盘中</span>" : lr && [
						"stopped",
						"error",
						"nowrite"
					].includes(lr.state) ? "<span class=\"pill bad\">落盘没完成</span>" : lr?.state === "ask" ? "<span class=\"pill mem\">等你回复</span>" : "") + (i.merging ? "<span class=\"pill mem\"><span class=\"dot\"></span>合并中</span>" : "") + (pend ? "<span class=\"pill\" title=\"合并前的落盘项目还在回收区，可撤销或删除\">合并前 <b>" + pend + "</b> 个待清理</span>" : "") + "<span class=\"pill\">仓库 <b>" + ci.repos.length + "</b></span>" + (ci.links.length ? "<span class=\"pill\">链接 <b>" + ci.links.length + "</b></span>" : "") + (ci.tasks.length ? "<span class=\"pill\">子任务 <b>" + ci.tasks.filter((t) => t.done).length + "/" + ci.tasks.length + "</b></span>" : "") + (ci.notes.trim() ? "<span class=\"pill\">说明</span>" : "") + (ci.files.length ? "<span class=\"pill\">文件 <b>" + ci.files.length + "</b></span>" : "");
					head = "<div class=\"sic-h\"><button type=\"button\" class=\"tgl\" data-tgl aria-expanded=\"" + this.open + "\">" + crumb + "<span class=\"pills\">" + pills + "</span></button><span class=\"acts\"><button type=\"button\" class=\"ib board\" data-board aria-label=\"在项目看板打开这张卡片\" title=\"在项目看板打开这张卡片\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3.5\" y=\"4\" width=\"4.5\" height=\"15\" rx=\"2.25\"/><rect x=\"9.75\" y=\"4\" width=\"4.5\" height=\"9.5\" rx=\"2.25\"/><rect x=\"16\" y=\"4\" width=\"4.5\" height=\"12.5\" rx=\"2.25\"/></svg></button>" + chev + "</span></div>" + this.folderHtml();
				}
				const g1 = memN ? "<section class=\"grp\" aria-label=\"落盘项目\"><div class=\"grp-h\">" + ic("mem") + "落盘项目<span class=\"n\">" + memN + "</span><span class=\"sp\"></span>" + (memN > 1 && !this.mg && !i.merging ? "<button type=\"button\" class=\"btn sm\" data-merge title=\"选几个合并成一个\">" + ic("merge") + "合并</button>" : "") + "</div>" + this.listHtml(mem) + (i.merging ? this.runHtml() : this.mg ? this.mgHtml(mem) : "") + "</section>" : "";
				const g2 = "<section class=\"grp\" aria-label=\"卡片资料\"><div class=\"grp-h\">" + ic("repo") + "卡片资料<span class=\"n\">" + matN + "</span><span class=\"sp\"></span><button type=\"button\" class=\"lnk\" data-raw title=\"插件每一步发给 AI 的卡片档案和落盘项目全文，逐字显示\">查看 AI 收到的原文</button></div>" + this.matHtml() + "</section>";
				this.root.className = "dpm-dock dpm-sic" + (memN ? " on" : " off") + (this.open ? " open" : "");
				const mk = this.root.querySelector("#dpmMkIn")?.value ?? "";
				this.root.innerHTML = head + "<div class=\"sic-b\"><div class=\"in\"><div class=\"scroll\">" + g1 + g2 + "</div></div></div>";
				const s = this.root.querySelector(".scroll");
				if (s) s.scrollTop = scroll;
				const mi = this.root.querySelector("#dpmMkIn");
				if (mi && mk) {
					mi.value = mk;
					this.mkTok();
				}
				this.fillMg();
				if (!memN) {
					this.fillMt();
					if (this.mt.q !== (mi?.value ?? "").trim()) this.scheduleMatch();
				}
				if (this.fresh) {
					const k = this.fresh;
					this.fresh = "";
					setTimeout(() => {
						reveal(this.root.querySelector("[data-row=\"" + CSS.escape(k) + "\"]")?.closest(".unit"));
					}, 50);
				}
			}
			lfRow(m, freshKey) {
				const run = this.info?.merging?.srcs.includes(m.key);
				const lr = this.info?.lfRun && this.info.lfRun.key === m.key ? this.info.lfRun : null;
				const busy = this.sending === m.key || lr?.state === "busy" || !!run;
				const picked = this.mg?.sel.has(m.key);
				const tags = (m.pointer ? "<span class=\"tag\" title=\"这份 STATE 只放了指向别处的路径，不存状态\">指针</span>" : "") + (m.merge ? "<span class=\"tag\" title=\"由 " + m.merge.srcs.length + " 个落盘项目合并而来\">合并结果</span>" : "") + "<span class=\"tag\">" + (m.from === "group" ? "卡片组关联" : m.from === "card" ? "卡片关联" : "卡片组 + 卡片") + "</span>";
				if (!m.found) return "<div class=\"lf\" data-row=\"" + esc(m.key) + "\"><div class=\"txt\"><div class=\"l1\"><span class=\"nm mq\">" + esc(m.key) + "</span>" + tags + "</div><div class=\"l2\">未找到这个落盘项目的 STATE（可能已移动或删除）</div></div></div>";
				const spec = (m.spec ?? []).filter((x) => x.id !== "location");
				const specTag = m.moveTo || spec.length ? "<span class=\"tag legacy\" title=\"" + esc([m.moveTo ? "落盘时插件会把整个文件夹迁到 ~/.ai/projects/" + m.moveTo + "/（可撤销）" : "", ...spec.map((x) => x.text + " → 落盘时 AI 按规范改")].filter(Boolean).join("\n")) + "\">" + (m.moveTo ? "落盘时迁到 " + esc(m.moveTo) : "旧规范 " + spec.length + " 处") + "</span>" : "";
				const ended = lr && [
					"stopped",
					"error",
					"nowrite",
					"ask"
				].includes(lr.state) ? lr : null;
				const st = ended ? this.endSt(ended) : m.injected ? ic("check") + "已注入 " + esc(m.version) : "<span class=\"pend\" title=\"下一步注入最新版\">待注入</span>";
				const l2 = ended ? "<div class=\"l2 mq" + (ended.state === "ask" ? "" : " bad") + "\">" + esc(this.endText(ended, m.version)) + "</div>" : "<div class=\"l2 mq\">" + esc(m.next || m.status || "暂无下一步") + "</div>";
				const btn = ended && ended.state !== "ask" ? "<button type=\"button\" class=\"btn sm\" data-dismiss title=\"不再提示\">忽略</button><button type=\"button\" class=\"btn sm pri lfb\" data-lf=\"" + esc(m.key) + "\" title=\"再发一次「落盘项目 " + esc(m.key) + "」\">" + ic("save") + "重新落盘</button>" : "<button type=\"button\" class=\"btn sm lfb\" data-lf=\"" + esc(m.key) + "\"" + (busy || ended ? " disabled" : "") + " title=\"" + (ended ? "回答 AI 的问题后它会接着写" : "在本会话执行「落盘项目 " + esc(m.key) + "」") + "\">" + (busy ? "<span class=\"spin\"></span>落盘中" : ended ? ic("save") + "等待回复" : ic("save") + "落盘") + "</button>";
				return "<div class=\"lf" + (busy ? " busy" : "") + (ended && ended.state !== "ask" ? " stopped" : "") + (picked ? " picked" : "") + (freshKey === m.key ? " fresh" : "") + "\" data-row=\"" + esc(m.key) + "\"><div class=\"txt\"><div class=\"l1\"><span class=\"nm mq\">" + esc(m.slug) + "</span><span class=\"pj\">" + esc(m.project) + "</span>" + specTag + tags + "</div>" + (m.aliases.length ? "<div class=\"l2 mq\" title=\"说出这些名字也会回忆 / 落盘这个项目\">别名：" + esc(m.aliases.join(" · ")) + "</div>" : "") + l2 + "</div><span class=\"st" + (ended ? " " + (ended.state === "ask" ? "wait" : "stop") : "") + "\" title=\"" + (ended ? "" : m.injected ? "插件已把最新全文注入本会话" : "本会话还没有当前版本，下一步注入") + "\">" + st + (ended ? "" : " · " + esc(wan(m.chars)) + (m.files ? " · " + m.files + " 个文件" : "")) + "</span>" + btn + "</div>";
			}
			listHtml(mem) {
				const fk = this.fresh;
				return "<div class=\"lfs\">" + mem.map((m) => m.merge || m.migration ? "<div class=\"unit" + (fk === m.key ? " fresh" : "") + "\">" + this.lfRow(m, "") + (m.merge ? this.doneHtml(m.merge) : "") + (m.migration ? this.migHtml(m, m.migration) : "") + "</div>" : this.lfRow(m, fk)).join("") + "</div>";
			}
			/** 合并完成卡片（挂在合并结果下面）；合并前的落盘项目若本身是合并结果，就在它下面缩进列出（可折叠、可单独删除）。 */
			oRows(v) {
				return v.srcs.map((s) => {
					const sub = s.sub && !s.sub.purged ? s.sub : null;
					const kids = sub ? sub.srcs.filter((x) => x.exists).length : 0;
					const open = sub ? !(this.shut.get(sub.id) ?? false) : false;
					const tg = kids ? "<button type=\"button\" class=\"ib xp\" data-exp=\"" + esc(sub.id) + "\" aria-expanded=\"" + open + "\" aria-label=\"展开或收起 " + esc(nm(s.key)) + " 合并前的 " + kids + " 个\" title=\"" + (open ? "收起" : "展开") + "它合并前的 " + kids + " 个\">" + ic("chev") + "</button>" : "<span class=\"xp-sp\"></span>";
					const what = s.sub ? "合并结果 · " + when(s.sub.at) + " 合并" + (s.sub.purged || !kids ? " · 它合并前的已删除" : "") : [s.kind === "pointer" ? "指针" : "", s.key === v.key ? "合并前的旧版" : ""].filter(Boolean).join(" · ");
					const del = kids ? "<button type=\"button\" class=\"btn sm danger ghost\" data-sub-del=\"" + esc(sub.id) + "\" title=\"只删 " + esc(nm(s.key)) + " 合并前的 " + sub.all + " 个；" + esc(nm(s.key)) + " 本身留着\"" + (this.ask.has(sub.id) ? " disabled" : "") + ">删除</button>" : "<span></span>";
					const row = "<div class=\"orow" + (s.exists ? "" : " gone") + "\">" + tg + "<span class=\"p mq\"><b>" + esc(nm(s.key)) + "</b><span>" + esc(pj(s.key)) + (what ? " · " + esc(what) : "") + (s.exists ? "" : " · 回收区里已不在") + "</span></span><span class=\"m\">" + esc(wan(s.chars)) + (s.files ? " · " + s.files + " 个文件" : "") + "</span>" + del + (s.retired ? copyBtn(s.retired + "/", "回收区路径") : "<span></span>") + "</div>";
					const lv = sub ? sub.srcs.map((x) => nm(x.key)).join("、") : "";
					return row + (sub && this.ask.has(sub.id) ? "<div class=\"ask in-row\" role=\"alertdialog\" aria-label=\"确认删除\"><b>永久删除 " + esc(nm(s.key)) + " 合并前的 " + sub.all + " 个落盘项目（" + esc(lv) + "）？</b><br>" + esc(nm(s.key)) + " 本身留在回收区：撤销 " + esc(nm(v.key)) + " 这次合并后 " + esc(nm(s.key)) + " 还会回来，但 " + esc(lv) + " 不能再恢复，" + esc(nm(s.key)) + " 那次合并也就不能撤销了。<div class=\"ft\"><span class=\"meta\"></span><button type=\"button\" class=\"btn sm\" data-ask-no=\"" + esc(sub.id) + "\">再想想</button><button type=\"button\" class=\"btn sm danger solid\" data-purge-yes=\"" + esc(sub.id) + "\"" + (this.busy.has(sub.id) ? " disabled" : "") + ">永久删除</button></div></div>" : "") + (kids && open ? "<div class=\"nest\">" + this.oRows(sub) + "</div>" : "");
				}).join("");
			}
			filesBlock(v) {
				const notes = v.files.filter((f) => f.rel.startsWith("notes/")).length + v.notes.length;
				const evi = v.files.filter((f) => f.rel.startsWith("evidence/")).length;
				const row = (k, val, extra = "") => "<div class=\"fr\"><span class=\"fk\">" + k + "</span><span class=\"fv\">" + val + "</span>" + extra + "</div>";
				const destPath = (this.info?.memDetail ?? []).find((m) => m.key === v.key) ? "~/.ai/projects/" + pj(v.key) + "/memory/designs/" + nm(v.key) + "/" : "";
				const li = v.files.map((f) => "<li><span class=\"fp mq\">" + esc(f.rel) + "</span><span class=\"ff mq\">" + esc(f.from.join("、")) + (f.from.length > 1 ? " · 内容相同只留一份" : "") + (f.ext ? " · 从 ~/.ai 外复制" : "") + "</span></li>").join("") + v.notes.map((n) => "<li><span class=\"fp mq\">" + esc(n) + "</span><span class=\"ff\">合并时写的要点</span></li>").join("");
				return "<details class=\"fx\"><summary>" + ic("chev") + "<b>文件归位</b><span class=\"fm\">都在 ~/.ai 里 · 按 dsh-project-manager 的落盘项目规范</span></summary><div class=\"fx-b\">" + row("合并结果", "<code class=\"mq\">" + esc(destPath) + "</code><span class=\"fs\">STATE.md · notes/ " + notes + " 份 · evidence/ " + evi + " 份 · 全部写进「📁 文件索引」</span>", destPath ? copyBtn(destPath, "文件夹路径") : "") + (li ? "<ul class=\"fl\">" + li + "</ul>" : "") + row("合并前的", v.retiredDirs.map((d) => "<code class=\"mq\">" + esc(home(d)) + "/</code>").join("") + "<span class=\"fs\">" + v.srcs.map((s) => esc(nm(s.key))).join("、") + " 整个文件夹已移入</span>") + (v.copied.length ? row("~/.ai 外的", "<span class=\"fs\">" + v.copied.length + " 个文件已复制进 evidence/，原文件不动，STATE 里的路径改指 ~/.ai：</span>" + v.copied.map((c) => "<code class=\"mq\">" + esc(home(c.path)) + "</code>").join("")) : "") + (v.missing.length ? row("找不到的", "<span class=\"fs warn-t\">" + v.missing.length + " 个本机已不存在，写进「⚠ 待核实」，不编造：</span>" + v.missing.map((c) => "<code class=\"mq\">" + esc(home(c)) + "</code>").join("")) : "") + (v.dropped.length ? row("不带过去", v.dropped.map((d) => "<code class=\"mq\">" + esc(d) + "</code>").join("") + "<span class=\"fs\">旧备份，留在回收区里</span>") : "") + "</div></details>";
			}
			doneHtml(v) {
				const n = v.srcs.length;
				const all = v.all;
				const lv = (x) => x.srcs.reduce((a, s) => a + (s.sub ? lv(s.sub) : 1), 0);
				const leaves = lv(v);
				const open = !(this.fold.get(v.id) ?? false);
				const r = v.report;
				const head = "<button type=\"button\" class=\"dn-h\" data-fold=\"" + esc(v.id) + "\" aria-expanded=\"" + open + "\"><span class=\"okc\">" + ic("check") + "</span><b>合并完成</b><span class=\"dn-m\">" + n + " → 1 · " + esc(when(v.at)) + "</span><span class=\"sp\"></span><span class=\"dn-m\">合并前 " + all + " 个在回收区</span>" + ic("chev") + "</button>";
				const inner = v.srcs.filter((s) => s.sub && !s.sub.purged).map((s) => s.key);
				const ask = this.ask.has(v.id) ? "<div class=\"ask\" role=\"alertdialog\" aria-label=\"确认删除\"><b>永久删除 " + esc(v.key) + " 合并前的 " + all + " 个落盘项目？</b><br>" + (inner.length ? "包括 " + inner.map(esc).join("、") + " 和它合并前的落盘项目。" : "") + "会删掉回收区里这 " + all + " 个文件夹，删了这次合并就不能撤销。合并结果和其他合并都不受影响。<div class=\"ft\"><span class=\"meta\"></span><button type=\"button\" class=\"btn sm\" data-ask-no=\"" + esc(v.id) + "\">再想想</button><button type=\"button\" class=\"btn sm danger solid\" data-purge-yes=\"" + esc(v.id) + "\"" + (this.busy.has(v.id) ? " disabled" : "") + ">永久删除</button></div></div>" : "";
				const body = "<div class=\"res\"><div><b>" + n + " → 1</b>落盘项目" + (leaves > n ? "（最初 " + leaves + " 个）" : "") + "</div><div><b>" + esc(r ? wan(r.chars).replace(" 万字", " 万").replace(" 字", "") : "-") + "</b>STATE 字数</div><div><b>" + (r?.files ?? v.files.length) + "</b>个子文档</div></div><p class=\"sub\">回读校验通过：没有丢章节，关键事实（commit / 路径 / 版本号 / 单号）都在" + (r?.drop ? "，有意删掉的 " + r.drop + " 条已列出" : "") + (r?.check ? "；「⚠ 待核实」" + r.check + " 条" : "") + "。" + (v.refs.length ? "外部引用改了 " + v.refs.length + " 处：" + v.refs.map((x) => esc(home(x))).join("、") + "。" : "没有需要改的外部引用。") + (v.refsFailed.length ? "<span class=\"warn-t\">另有 " + v.refsFailed.length + " 处没改成：" + v.refsFailed.map((x) => esc(home(x.file))).join("、") + "</span>" : "") + "</p>" + this.filesBlock(v) + "<div class=\"old\"><p class=\"old-t\">合并前的落盘项目 " + n + " 个" + (all > n ? "（含更早合并的 " + (all - n) + " 个）" : "") + " · 在回收区" + (v.undo ? "" : "，可撤销") + "</p>" + this.oRows(v) + "</div>" + ask + "<div class=\"ft\"><span class=\"meta mq\" title=\"" + esc(v.undo ?? "") + "\">" + esc(v.undo ? "不能撤销：" + v.undo : "撤销回到 " + v.srcs.map((s) => nm(s.key)).join("、")) + "</span><button type=\"button\" class=\"btn sm\" data-mg-undo=\"" + esc(v.id) + "\"" + (v.undo || this.busy.has(v.id) ? " disabled" : "") + " title=\"只退回这一次合并\">" + ic("undo") + "撤销合并</button><button type=\"button\" class=\"btn sm danger\" data-purge=\"" + esc(v.id) + "\"" + (this.ask.has(v.id) || this.busy.has(v.id) ? " disabled" : "") + ">删除合并前的落盘项目</button></div>";
				return "<div class=\"dn" + (open ? " open" : "") + "\" id=\"dpm-dn-" + esc(v.id) + "\">" + head + "<div class=\"dn-b\"><div class=\"in\"><div class=\"dn-body\">" + body + "</div></div></div></div>";
			}
			runHtml() {
				const r = this.info.merging;
				const tl = [
					[
						"读全来源",
						r.srcs.length + " 份 STATE + [必读] 子文档 · " + r.read + "/" + r.total,
						r.read >= r.total ? 2 : 1
					],
					[
						"逐份写要点",
						"防止上下文压缩丢进度 · " + r.noted + "/" + r.total,
						r.noted >= r.total ? 2 : r.read >= r.total ? 1 : 0
					],
					[
						"整体重写并提交",
						"一份 STATE + notes/；插件校验关键事实、文件索引，归位文件、换关联、改外部引用",
						r.noted >= r.total ? 1 : 0
					]
				].map(([t, s, k]) => "<li class=\"" + (k === 2 ? "ok" : k === 1 ? "on" : "") + "\"><span class=\"nd\">" + (k === 2 ? ic("check") : "") + "</span><div style=\"flex:1;min-width:0\"><div>" + t + "</div><div class=\"mono\">" + esc(s) + "</div>" + (k === 1 && t === "读全来源" ? "<div class=\"bar\"><i style=\"width:" + Math.round(r.read / Math.max(1, r.total) * 100) + "%\"></i></div>" : "") + "</div></li>").join("");
				return "<div class=\"mg\" id=\"dpmMg\"><h4>正在把 " + r.total + " 个合并到 " + esc(r.key) + "</h4><p class=\"sub\">合并在本会话里由 AI 进行，期间可以照常看进度；关掉页面也不会中断。</p><ul class=\"tl\">" + tl + "</ul><div class=\"ft\"><span class=\"meta\">还没提交前可以取消，什么都不会改</span><button type=\"button\" class=\"btn sm\" data-mg-abort=\"" + esc(r.id) + "\">取消合并</button></div></div>";
			}
			mgHtml(mem) {
				const m = this.mg;
				return "<div class=\"mg\" id=\"dpmMg\"><h4 id=\"dpmMgT\"></h4><p class=\"sub\">默认全选，取消勾选的保持原样。本会话的 AI 先读全所选来源，再整体重写成一份；来源不删除，移到回收区，可以一键撤销。</p><div class=\"srcs-h\"><span id=\"dpmMgCount\" aria-live=\"polite\"></span><span class=\"sp\"></span><button type=\"button\" class=\"btn sm\" id=\"dpmSelAll\" data-sel-all>全选</button><button type=\"button\" class=\"btn sm\" id=\"dpmSelNone\" data-sel-none>全不选</button></div><div class=\"srcs\">" + mem.filter((x) => x.found).map((x) => "<label class=\"src\" title=\"" + esc(x.merge ? "合并结果：它合并前的 " + x.merge.all + " 个会一起归到这次新合并下" : x.key) + "\"><input type=\"checkbox\" data-src=\"" + esc(x.key) + "\"" + (m.sel.has(x.key) ? " checked" : "") + "><span class=\"p mq\">" + esc(x.key) + "</span><span class=\"m\">" + (x.pointer ? "指针 · " : "") + (x.merge ? "合并结果 · " : "") + esc(wan(x.chars)) + (x.files ? " · " + x.files + " 个文件" : "") + "</span></label>").join("") + "</div><div class=\"tgt\"><label for=\"dpmMgName\">合并成</label><div class=\"fld\"><span class=\"mono\" id=\"dpmMgPj\"></span><input id=\"dpmMgName\" type=\"text\" spellcheck=\"false\" autocomplete=\"off\"></div><label>别名</label><div class=\"als\" id=\"dpmMgAls\"></div></div><p class=\"warn\" id=\"dpmMgWarn\" role=\"status\"></p><ol class=\"plan\" id=\"dpmMgPlan\"></ol><div id=\"dpmMgFiles\"></div><div class=\"ft\"><span class=\"meta\" id=\"dpmMgMeta\"></span><button type=\"button\" class=\"btn sm\" data-mg-cancel>取消</button><button type=\"button\" class=\"btn sm pri\" data-mg-go id=\"dpmMgGo\">" + ic("merge") + "开始合并</button></div></div>";
			}
			/** 合并面板里随勾选 / 名字变化的部分（不重画整块，保留焦点）。 */
			fillMg() {
				const m = this.mg;
				const box = this.root.querySelector("#dpmMg");
				if (!m || !box || this.info?.merging) return;
				const $ = (id) => box.querySelector("#" + id);
				const mem = (this.info?.memDetail ?? []).filter((x) => x.found);
				const chosen = mem.filter((x) => m.sel.has(x.key));
				const n = chosen.length;
				const first = chosen.find((x) => !x.pointer) ?? chosen[0];
				const inp = $("dpmMgName");
				if (!m.touched && first && document.activeElement !== inp) {
					m.name = first.slug;
					inp.value = m.name;
				} else if (inp.value !== m.name && document.activeElement !== inp) inp.value = m.name;
				$("dpmMgPj").textContent = (first ? first.project : "项目") + " /";
				$("dpmMgT").textContent = n >= 2 ? "合并 " + n + " 个落盘项目" : "合并落盘项目";
				const pv = m.pv;
				const okPv = !!pv && n >= 2;
				$("dpmMgAls").innerHTML = okPv && pv.aliases.length ? pv.aliases.map((a) => "<span>" + esc(a) + "</span>").join("") : "<span class=\"none\">" + (n >= 2 ? "无" : "—") + "</span>";
				const warn = n < 2 ? "至少选 2 个才能合并" : !NAME_RE.test(m.name) ? "名字只能用字母、数字和 . _ -" : m.err ? m.err : pv?.clash ? "「" + pv.key + "」已存在且没被选上：换个名字，或把它也选进来" : pv?.busy ? "其中有落盘项目正在另一次合并里" : pv && !pv.toolOk ? "合并需要新版 ai-memory：先在项目看板顶部点「升级 ai-memory」" : "";
				const w = $("dpmMgWarn");
				w.textContent = warn;
				w.hidden = !warn;
				const rest = mem.length - n;
				const mm = chosen.filter((x) => x.merge);
				const ptr = chosen.filter((x) => x.pointer).length;
				const plan = n < 2 || !pv ? ["选好后这里会列出合并会做的事"] : [
					"AI 读全 <b>" + n + " 份 STATE</b> 与它们的 [必读] 子文档（约 " + wan(pv.chars) + "，分段读完）；每读完一份先写一份要点",
					"整体重写成 <b>一份 STATE</b>（≤3 万字），细节写进 <b>notes/</b>；来源之间说法矛盾的写进「⚠ 待核实」，不替你选边",
					"所有文件归位到 <b>~/.ai</b>：明细见下面「文件去向」",
					pv.aliases.length ? "被合并的名字变成别名：<b>说「回忆 " + esc(pv.aliases[0]) + "」照样能找到</b>" + (ptr ? "（其中 " + ptr + " 份是指针，只存了路径）" : "") : "",
					mm.length ? "其中 " + mm.map((x) => "<b>" + esc(x.slug) + "</b>").join("、") + " 是合并结果：它合并前的一起归到这次合并下；<b>撤销这次合并会回到现在的样子</b>" : "",
					"卡片和卡片组里这 " + n + " 个关联换成合并结果" + (pv.refs.length ? "；~/.ai 里引用旧路径的 <b>" + pv.refs.length + " 处</b>一并改指向" : ""),
					rest ? "<b>没选的 " + rest + " 个保持原样</b>，照常显示和注入" : ""
				].filter(Boolean);
				$("dpmMgPlan").innerHTML = plan.map((t) => "<li>" + t + "</li>").join("");
				const fx = $("dpmMgFiles");
				const wasOpen = fx.querySelector("details")?.open ?? true;
				fx.innerHTML = okPv && !warn ? this.previewFiles(pv) : "";
				const nd = fx.querySelector("details");
				if (nd) nd.open = wasOpen;
				$("dpmMgMeta").textContent = m.busy ? "正在发出…" : rest ? "没选的 " + rest + " 个不动" : "合并在本会话里进行，期间能看进度";
				$("dpmMgGo").disabled = !!warn || !pv || m.busy;
				$("dpmMgCount").textContent = "已选 " + n + " / " + mem.length;
				$("dpmSelAll").disabled = n === mem.length;
				$("dpmSelNone").disabled = !n;
				box.querySelectorAll("[data-src]").forEach((el) => {
					el.checked = m.sel.has(el.dataset.src);
				});
				this.root.querySelectorAll("[data-row]").forEach((el) => el.classList.toggle("picked", m.sel.has(el.dataset.row)));
			}
			previewFiles(pv) {
				const row = (k, v, extra = "") => "<div class=\"fr\"><span class=\"fk\">" + k + "</span><span class=\"fv\">" + v + "</span>" + extra + "</div>";
				const dest = "~/.ai/projects/" + pj(pv.key) + "/memory/designs/" + nm(pv.key) + "/";
				const notes = pv.files.filter((f) => f.rel.startsWith("notes/")).length + pv.notes.length;
				const evi = pv.files.filter((f) => f.rel.startsWith("evidence/")).length;
				const li = pv.files.map((f) => "<li><span class=\"fp mq\">" + esc(f.rel) + "</span><span class=\"ff mq\">" + esc(f.from.join("、")) + (f.from.length > 1 ? " · 内容相同只留一份" : "") + (f.ext ? " · 从 ~/.ai 外复制" : "") + "</span></li>").join("") + pv.notes.map((x) => "<li><span class=\"fp mq\">" + esc(x) + "</span><span class=\"ff\">合并时写的要点</span></li>").join("");
				return "<details class=\"fx\" open><summary>" + ic("chev") + "<b>文件去向</b><span class=\"fm\">都在 ~/.ai 里 · 按 dsh-project-manager 的落盘项目规范</span></summary><div class=\"fx-b\">" + row("合并结果", "<code class=\"mq\">" + esc(dest) + "</code><span class=\"fs\">STATE.md（重写）· notes/ " + notes + " 份 · evidence/ " + evi + " 份 · 全部写进「📁 文件索引」</span>", copyBtn(dest, "文件夹路径")) + (li ? "<ul class=\"fl\">" + li + "</ul>" : "") + row("合并前的", pv.retired.map((x) => "<code class=\"mq\">" + esc(home(x.path)) + "</code><span class=\"fs\">" + x.names.map(esc).join("、") + " 整个文件夹移入</span>").join("")) + (pv.copied.length ? row("~/.ai 外的", "<span class=\"fs\">" + pv.copied.length + " 个文件复制进 evidence/，原文件不动，STATE 里的路径改指 ~/.ai：</span>" + pv.copied.map((c) => "<code class=\"mq\">" + esc(home(c.path)) + "</code>").join("")) : "") + (pv.missing.length ? row("找不到的", "<span class=\"fs warn-t\">" + pv.missing.length + " 个本机已不存在，写进「⚠ 待核实」，不编造：</span>" + pv.missing.map((c) => "<code class=\"mq\">" + esc(home(c.path)) + "</code>").join("")) : "") + (pv.dropped.length ? row("不带过去", pv.dropped.map((d) => "<code class=\"mq\">" + esc(d.rel) + "</code>").join("") + "<span class=\"fs\">旧备份，留在回收区里</span>") : "") + (pv.refs.length ? row("外部引用", pv.refs.map((x) => "<code class=\"mq\">" + esc(home(x)) + "</code>").join("") + "<span class=\"fs\">里面的旧路径改指合并结果（撤销时改回）</span>") : "") + "</div></details>";
			}
			schedulePreview() {
				clearTimeout(this.pvTimer);
				const m = this.mg;
				if (!m) return;
				m.pv = m.sel.size >= 2 ? m.pv : null;
				m.err = "";
				this.fillMg();
				if (m.sel.size < 2 || !NAME_RE.test(m.name)) return;
				const seq = ++m.seq;
				this.pvTimer = window.setTimeout(() => {
					getMergePreview(this.sid, [...m.sel], m.name).then((pv) => {
						if (this.mg !== m || m.seq !== seq) return;
						m.pv = pv;
						m.err = "";
						if (!m.touched) m.name = nm(pv.key);
						this.fillMg();
					}).catch((e) => {
						if (this.mg !== m || m.seq !== seq) return;
						m.pv = null;
						m.err = e instanceof ApiError ? e.message : String(e);
						this.fillMg();
					});
				}, 200);
			}
			matHtml() {
				const ci = this.info.cardInfo;
				const sec = (icon, t, n, body) => "<div class=\"ma-s\"><p class=\"ma-t\">" + ic(icon) + t + " <span class=\"c\">" + n + "</span></p>" + body + "</div>";
				const repos = ci.repos.length ? ci.repos.map((r) => "<div class=\"row\"><span class=\"k mq\">" + esc(r.name) + "</span><span class=\"v mono mq\">" + esc(r.path) + "</span>" + copyBtn(r.path, "仓库路径") + "</div>").join("") : "<p class=\"empty\">没有仓库</p>";
				const tasks = ci.tasks.length ? ci.tasks.map((t) => "<div class=\"row task" + (t.done ? " dn" : "") + "\"><span class=\"bx\">" + (t.done ? ic("check") : "") + "</span><span class=\"v mq\">" + esc(t.text) + "</span></div>").join("") : "<p class=\"empty\">没有子任务</p>";
				const notes = ci.notes.trim() ? "<p class=\"note\">" + esc(ci.notes) + "</p>" : "<p class=\"empty\">没有相关说明</p>";
				const links = ci.links.length ? ci.links.map((l) => "<div class=\"row\"><span class=\"ty\">" + esc(l.type) + "</span><span class=\"v pri mq\" title=\"" + esc(l.url) + "\">" + esc(l.text) + "</span>" + copyBtn(l.url, "链接") + "<a class=\"ib\" href=\"" + esc(l.url) + "\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"打开链接 " + esc(l.text) + "\" title=\"打开链接\">" + ic("ext") + "</a></div>").join("") : "<p class=\"empty\">没有相关链接</p>";
				const files = ci.files.length ? ci.files.map((f) => "<div class=\"row" + (f.exists ? "" : " gone") + "\"><span class=\"k mq\">" + esc(f.path.split("/").pop() ?? f.path) + "</span><span class=\"v mono mq\">" + esc(f.path) + (f.exists ? "" : "（已删除）") + "</span>" + copyBtn(f.path, "文件路径") + "</div>").join("") : "<p class=\"empty\">没有相关文件</p>";
				return "<div class=\"ma\">" + sec("repo", "仓库", ci.repos.length, repos) + sec("clip", "子任务", ci.tasks.length ? ci.tasks.filter((t) => t.done).length + "/" + ci.tasks.length : 0, tasks) + sec("note", "相关说明", ci.notes.trim() ? ci.notes.length + " 字" : 0, notes) + sec("link", "相关链接", ci.links.length, links) + sec("file", "相关文件", ci.files.length, files) + "</div>";
			}
			mkTok() {
				const inp = this.root.querySelector("#dpmMkIn");
				const box = this.root.querySelector("#dpmMkTok");
				if (!inp || !box) return;
				const names = inp.value.split(/\s+/).filter(Boolean);
				const raw = names.find((n) => !/[\u4e00-\u9fff]/.test(n));
				const ex = this.mt.r?.mode === "exact" && this.mt.q === inp.value.trim() ? this.mt.r.hits : [];
				const dup = (n) => ex.some((h) => h.slug.toLowerCase() === n.toLowerCase() || h.aliases.some((a) => a.toLowerCase() === n.toLowerCase()));
				box.innerHTML = names.slice(0, 4).map((n) => "<span class=\"" + (dup(n) ? "dup" : n === raw ? "file" : "") + "\">" + esc(n) + (dup(n) ? " · 已存在" : n === raw ? " · 文件名" : "") + "</span>").join("");
			}
			hhmm(t) {
				const d = new Date(t);
				return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
			}
			endSt(r) {
				return r.state === "ask" ? ic("ask") + "等你回复" : r.state === "error" ? ic("x") + "出错停止，没写入" : r.state === "nowrite" ? ic("x") + "这一轮没写入" : ic("stop") + "已停止，没写入";
			}
			endText(r, ver = "") {
				const at = this.hhmm(r.end ?? r.at);
				if (r.state === "ask") return "AI 落盘前在问你问题，回答后它会接着写";
				if (r.state === "error") return (r.error ? r.error.slice(0, 80) + " · " : "") + at + " 那一轮中断" + (ver ? "，STATE 没变（仍是 " + ver + "）" : "");
				if (r.state === "nowrite") return at + " 那一轮结束了，但没有写入" + (ver ? "（STATE 仍是 " + ver + "）" : "") + "：AI 可能没完成或在等你";
				return "「落盘项目 " + (r.key || r.label) + "」那一轮在 " + at + " 被停止" + (ver ? "，STATE 没变（仍是 " + ver + "）" : "");
			}
			/** 未关联时首行的主按钮：进行中 / 等回复 / 重新新建 / 关联并落盘（完全同名）/ 新建并落盘。 */
			mkBtn(run, busy) {
				if (busy) return "<button type=\"button\" class=\"btn sm pri\" disabled>" + (run?.state === "ask" ? "等待回复" : "<span class=\"spin\"></span>落盘中") + "</button>";
				const m = this.mt.r;
				if (m?.mode === "exact" && m.hits[0]) return "<button type=\"button\" class=\"btn sm pri\" data-link-lf=\"" + esc(m.hits[0].key) + "\" title=\"关联 " + esc(m.hits[0].key) + " 并在本会话落盘\">" + ic("save") + "关联并落盘</button>";
				return "<button type=\"button\" class=\"btn sm pri\" data-mk>" + ic("plus") + (run && run.state !== "done" ? "重新新建并落盘" : "新建并落盘") + "</button>";
			}
			runLine(run) {
				if (!run || run.state === "busy" || run.state === "done") return "";
				const label = "「新建 " + run.label + "」";
				if (run.state === "ask") return "<div class=\"hint-l\">AI 在问你问题，回答后它会接着建</div>";
				const em = run.state === "error" ? "出错停止" : run.state === "nowrite" ? "没建出来" : "已停止";
				const why = run.state === "error" ? (run.error ? run.error.slice(0, 80) + "，" : "") + "还没建出来" : run.state === "nowrite" ? label + "那一轮结束了，但没有写入" : label + "那一轮在 " + this.hhmm(run.end ?? run.at) + " 被停止，还没建出来";
				return "<div class=\"hint-l\" role=\"status\"><span class=\"em\">" + em + "</span><span class=\"mq\">" + esc(why) + "</span><span class=\"sp\"></span><button type=\"button\" class=\"lnk\" data-dismiss>忽略</button></div>";
			}
			/** 卡片组还没设落盘文件夹：落盘前请用户确认一次（按组名给建议，可改）。 */
			folderHtml() {
				const fo = this.info?.folder;
				if (!this.ask0 || !fo || fo.value) return "";
				return "<div class=\"fo\" role=\"dialog\" aria-label=\"确认卡片组的落盘文件夹\"><p class=\"fo-t\">先给卡片组「" + esc(fo.group) + "」定一个落盘文件夹（只问这一次）</p><p class=\"fo-s\">这个组的落盘项目以后都放这里；旧的落盘项目在下次落盘时自动迁过来（可撤销）。</p><div class=\"fo-r\"><label class=\"fld\"><span class=\"pre\">~/.ai/projects/</span><input id=\"dpmFoIn\" value=\"" + esc(fo.suggest ?? "") + "\" spellcheck=\"false\" autocomplete=\"off\" aria-label=\"落盘文件夹名\"><span class=\"pre\">/</span></label><button type=\"button\" class=\"btn sm\" data-fo-no>取消</button><button type=\"button\" class=\"btn sm pri\" data-fo-ok>确认并继续</button></div><p class=\"fo-e\" id=\"dpmFoErr\" role=\"status\"></p></div>";
			}
			migHtml(m, v) {
				const open = !(this.fold.get(v.id) ?? true);
				const head = "<button type=\"button\" class=\"dn-h\" data-fold=\"" + esc(v.id) + "\" aria-expanded=\"" + open + "\"><span class=\"okc\">" + ic("check") + "</span><b>已按规范迁移</b><span class=\"dn-m\">" + esc(pj(v.from)) + " → " + esc(m.project) + " · " + esc(when(v.at)) + "</span><span class=\"sp\"></span>" + ic("chev") + "</button>";
				const body = "<p class=\"sub\">落盘时插件把整个文件夹从 " + esc(v.from) + " 迁到了卡片组的落盘文件夹" + ([v.files ? v.files + " 个子文档一起搬过来，里面的旧路径已改指新位置" : "", v.refs ? "~/.ai 里 " + v.refs + " 处外部引用已改指向" : ""].filter(Boolean).map((x, k) => (k ? "；" : "（") + x).join("") + ([v.files, v.refs].some(Boolean) ? "）" : "")) + "。" + (v.exists ? "旧文件夹在回收区：" : "旧文件夹已不在回收区。") + "</p>" + (v.exists ? "<div class=\"orow\"><span class=\"xp-sp\"></span><span class=\"p mq\"><b>" + esc(nm(v.from)) + "</b><span>" + esc(home(v.retired)) + "/</span></span><span></span><span></span>" + copyBtn(v.retired + "/", "回收区路径") + "</div>" : "") + "<div class=\"ft\"><span class=\"meta mq\" title=\"" + esc(v.undo ?? "") + "\">" + esc(v.undo ? "不能撤销：" + v.undo : "撤销 = 搬回 " + v.from + "（之后不再自动迁）") + "</span><button type=\"button\" class=\"btn sm\" data-mig-undo=\"" + esc(v.id) + "\"" + (v.undo || this.busy.has(v.id) ? " disabled" : "") + ">" + ic("undo") + "撤销迁移</button><button type=\"button\" class=\"btn sm danger\" data-mig-purge=\"" + esc(v.id) + "\"" + (this.busy.has(v.id) ? " disabled" : "") + ">" + (v.exists ? "删除旧文件夹" : "不再显示") + "</button></div>";
				return "<div class=\"dn" + (open ? " open" : "") + "\" id=\"dpm-dn-" + esc(v.id) + "\">" + head + "<div class=\"dn-b\"><div class=\"in\"><div class=\"dn-body\">" + body + "</div></div></div></div>";
			}
			scheduleMatch() {
				clearTimeout(this.mtTimer);
				const q = (this.root.querySelector("#dpmMkIn")?.value ?? "").trim();
				if (q === this.mt.q) return;
				const seq = ++this.mt.seq;
				this.mtTimer = window.setTimeout(() => {
					getMatch(this.sid, q).then((r) => {
						if (this.dead || seq !== this.mt.seq) return;
						this.mt = {
							q,
							r,
							seq
						};
						this.fillMt();
					}, () => void 0);
				}, 200);
			}
			/** 同名候选区 + 主按钮 + 名字标签（局部更新，不动输入框）。 */
			fillMt() {
				const box = this.root.querySelector("#dpmMtIn");
				if (!box) return;
				const r = this.mt.r;
				const run = this.info?.lfRun && !this.info.lfRun.key ? this.info.lfRun : null;
				const busy = !!this.sending || run?.state === "busy" || run?.state === "ask";
				const btn = this.root.querySelector("#dpmMkBtn");
				if (btn) btn.innerHTML = this.mkBtn(run, busy);
				this.root.querySelector("#dpmMk")?.classList.toggle("dup", r?.mode === "exact");
				this.mkTok();
				const mt = this.root.querySelector("#dpmMt");
				const show = !!r && r.hits.length > 0 && !busy && !this.ask0;
				mt?.classList.toggle("on", show);
				if (!show || !r) {
					box.innerHTML = "";
					return;
				}
				const title = {
					hint: "可能就是这个",
					exact: "已有同名落盘项目",
					near: "名字相近的落盘项目",
					none: ""
				}[r.mode];
				const why = {
					hint: "按卡片名找到的",
					exact: "同名不能再新建（回忆 / 落盘会分不清是哪个）",
					near: "确认不是同一个的话，照常新建",
					none: ""
				}[r.mode];
				const q0 = r.mode === "near" ? (this.mt.q.split(/\s+/).find((n) => !/[\u4e00-\u9fff]/.test(n)) ?? "").toLowerCase() : "";
				const hl = (sl) => {
					const i = q0 ? sl.toLowerCase().indexOf(q0) : -1;
					return i < 0 ? esc(sl) : esc(sl.slice(0, i)) + "<mark>" + esc(sl.slice(i, i + q0.length)) + "</mark>" + esc(sl.slice(i + q0.length));
				};
				const cands = r.hits.map((h) => "<div class=\"cand" + (r.mode === "exact" ? " exact" : "") + "\"><div class=\"txt\"><div class=\"l1\"><span class=\"nm mq\">" + hl(h.slug) + "</span><span class=\"pj\">" + esc(h.project) + "</span>" + (h.aliases.length ? "<span class=\"tag mq\">别名 " + esc(h.aliases.slice(0, 3).join(" · ")) + "</span>" : "") + "</div><div class=\"l2 mq\">" + esc(h.why) + " · " + esc(wan(h.chars)) + " · " + esc(h.updated) + " 更新 · " + (h.cards.length ? "已关联卡片「" + esc(h.cards.join("」「")) + "」" : "还没关联任何卡片") + "</div>" + (h.moveTo ? "<div class=\"l3\">落盘时迁到 <b>~/.ai/projects/" + esc(h.moveTo) + "/memory/designs/" + esc(h.slug) + "/</b>（可撤销）</div>" : "") + "</div><span class=\"cacts\"><button type=\"button\" class=\"btn sm\" data-only-lf=\"" + esc(h.key) + "\" title=\"只关联到本卡片，不落盘\">只关联</button><button type=\"button\" class=\"btn sm pri\" data-link-lf=\"" + esc(h.key) + "\" title=\"关联到本卡片，并在本会话执行「落盘项目 " + esc(h.key) + "」\">" + ic("save") + "关联并落盘</button></span></div>").join("");
				const sug = r.mode === "exact" ? nm(r.hits[0].key) + "-2" : "";
				const foot = r.mode === "exact" ? "<p class=\"mt-f\">要另起一个新的？换个名字，例如 <button type=\"button\" class=\"lnk\" data-fill=\"" + esc(sug) + "\">" + esc(sug) + "</button></p>" : r.mode === "hint" ? "<p class=\"mt-f\">不是它？直接在上面输入新名字</p>" : "";
				box.innerHTML = "<div class=\"mt-b\"><p class=\"mt-t\">" + esc(title) + "<span class=\"sp\"></span><span class=\"why\">" + esc(why) + "</span></p>" + cands + foot + "</div>";
			}
			/** 发「落盘项目 …」：先登记这一轮（信息卡据此跟踪结局），再排进会话。 */
			async sendLf(key, label, text, toast) {
				if (this.sending) return;
				this.sending = key || "__new";
				this.render();
				try {
					await post("lf/run", {
						sessionId: this.sid,
						key,
						label
					});
					await this.host.send(this.sid, text);
					this.host.toast(toast);
				} catch (e) {
					await post("lf/run-dismiss", { sessionId: this.sid }).catch(() => void 0);
					this.host.toast("发送失败：" + (e instanceof Error ? e.message : String(e)), "err");
				} finally {
					this.sending = null;
					await this.load(true);
				}
			}
			/** 卡片组还没设落盘文件夹 → 先确认（只问一次），确认后继续原来的动作。 */
			needFolder(next) {
				const fo = this.info?.folder;
				if (!fo || fo.value) return false;
				this.ask0 = next;
				this.open = true;
				this.render();
				setTimeout(() => {
					const i = this.root.querySelector("#dpmFoIn");
					i?.focus();
					i?.select();
				}, 30);
				return true;
			}
			async linkLf(key, persist) {
				if (persist && this.needFolder({
					kind: "key",
					key
				})) return;
				try {
					await post("lf/link", {
						sessionId: this.sid,
						key
					});
				} catch (e) {
					this.host.toast("关联失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
					return;
				}
				const el = this.root.querySelector("#dpmMkIn");
				if (el) el.value = "";
				this.mt = {
					q: "\0",
					r: null,
					seq: this.mt.seq + 1
				};
				this.open = true;
				if (!persist) {
					this.host.toast("已把 " + key + " 关联到这张卡片");
					await this.load(true);
					return;
				}
				await this.sendLf(key, key, "落盘项目 " + key, "已关联 " + key + "，并在本会话发出「落盘项目 " + key + "」");
			}
			onInput = (e) => {
				const t = e.target;
				if (t.id === "dpmMkIn") {
					this.mkTok();
					this.scheduleMatch();
					return;
				}
				if (t.id === "dpmFoIn") {
					const e = this.root.querySelector("#dpmFoErr");
					if (e) e.textContent = "";
					return;
				}
				if (t.id === "dpmMgName" && this.mg) {
					this.mg.name = t.value.trim();
					this.mg.touched = true;
					this.schedulePreview();
				}
			};
			onChange = (e) => {
				const t = e.target;
				if (this.mg && t.dataset.src !== void 0) {
					if (t.checked) this.mg.sel.add(t.dataset.src);
					else this.mg.sel.delete(t.dataset.src);
					this.schedulePreview();
				}
			};
			onKey = (e) => {
				const t = e.target;
				if (e.key === "Enter" && t.id === "dpmMkIn") {
					e.preventDefault();
					const m = this.mt.r;
					if (m?.mode === "exact" && m.hits[0] && this.mt.q === t.value.trim()) this.linkLf(m.hits[0].key, true);
					else this.make();
				}
				if (e.key === "Enter" && t.id === "dpmFoIn") {
					e.preventDefault();
					this.saveFolder();
				}
				if (e.key === "Escape" && t.id === "dpmFoIn") {
					e.preventDefault();
					this.ask0 = null;
					this.render();
				}
			};
			toggle() {
				this.open = !this.open;
				this.root.classList.toggle("open", this.open);
				this.root.querySelectorAll("[data-tgl]").forEach((b) => b.setAttribute("aria-expanded", String(this.open)));
			}
			async act(id, fn, ok) {
				if (this.busy.has(id)) return;
				this.busy.add(id);
				this.render();
				try {
					const r = await fn();
					this.host.toast(ok(r));
				} catch (e) {
					this.host.toast(e instanceof ApiError ? e.message : String(e), "err");
				} finally {
					this.busy.delete(id);
					this.ask.delete(id);
					await this.load(true);
				}
			}
			async saveFolder() {
				const inp = this.root.querySelector("#dpmFoIn");
				const v = (inp?.value ?? "").trim().toLowerCase();
				const err = this.root.querySelector("#dpmFoErr");
				if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v)) {
					if (err) err.textContent = "只能用小写字母、数字和 . _ -，以字母或数字开头";
					inp?.focus();
					return;
				}
				try {
					await post("lf/folder", {
						sessionId: this.sid,
						value: v
					});
				} catch (e) {
					if (err) err.textContent = e instanceof ApiError ? e.message : String(e);
					inp?.focus();
					return;
				}
				const next = this.ask0;
				this.ask0 = null;
				this.host.toast("卡片组「" + (this.info?.folder?.group ?? "") + "」的落盘文件夹：~/.ai/projects/" + v + "/");
				await this.load(true);
				if (next?.kind === "key" && next.key) {
					if ((this.info?.memDetail ?? []).some((x) => x.key === next.key)) await this.sendLf(next.key, next.key, "落盘项目 " + next.key, "已在本会话发出「落盘项目 " + next.key + "」");
					else await this.linkLf(next.key, true);
				} else if (next?.kind === "new") await this.make();
			}
			async make() {
				if (this.sending) return;
				const v = (this.root.querySelector("#dpmMkIn")?.value ?? "").trim();
				const m = this.mt.r;
				if (m?.mode === "exact" && this.mt.q === v && m.hits[0]) {
					this.host.toast("已有同名落盘项目 " + m.hits[0].key + "：点「关联并落盘」，或换个名字", "err");
					return;
				}
				if (this.needFolder({ kind: "new" })) return;
				const { file, aliases } = parseNames(v);
				const text = file ? "落盘项目：新建 " + file + (aliases.length ? "（别名：" + aliases.join("、") + "，写进 STATE 的 aliases: 行）" : "") + "，关联到本卡片" : v ? "落盘项目：新建，名字由你按「" + v + "」起一个英文文件名（这些词都写进 STATE 的 aliases: 行），关联到本卡片" : "落盘项目：新建，名字由你按本会话内容起，关联到本卡片";
				await this.sendLf("", file ?? (v || "AI 起名"), text, file ? "已发出「落盘项目 新建 " + file + "」" + (aliases.length ? "，别名 " + aliases.join(" ") : "") : "已发出「落盘项目 新建」，名字由 AI 起");
			}
			onClick = (e) => {
				const t = e.target.closest("button, a, summary");
				if (!t || !this.root.contains(t)) return;
				const d = t.dataset;
				const i = this.info;
				if (d.tgl !== void 0) return this.toggle();
				if (d.board !== void 0 && i?.card) return this.host.openBoard(i.card.id);
				if (d.raw !== void 0) {
					this.openRaw(t);
					return;
				}
				if (d.copy !== void 0) {
					this.copy(t, d.copy, d.what ?? "");
					return;
				}
				if (d.mk !== void 0) {
					this.make();
					return;
				}
				if (d.linkLf) {
					this.linkLf(d.linkLf, true);
					return;
				}
				if (d.onlyLf) {
					this.linkLf(d.onlyLf, false);
					return;
				}
				if (d.fill) {
					const el = this.root.querySelector("#dpmMkIn");
					if (el) {
						el.value = d.fill;
						el.focus();
						this.mkTok();
						this.scheduleMatch();
					}
					return;
				}
				if (d.foOk !== void 0) {
					this.saveFolder();
					return;
				}
				if (d.foNo !== void 0) {
					this.ask0 = null;
					this.render();
					return;
				}
				if (d.dismiss !== void 0) {
					post("lf/run-dismiss", { sessionId: this.sid }).then(() => this.load(true));
					return;
				}
				if (d.migUndo) {
					const id = d.migUndo;
					this.act(id, () => post("lf/migrate-undo", { id }), (r) => "已撤销迁移：搬回 " + r.key + "，之后落盘不再自动迁");
					return;
				}
				if (d.migPurge) {
					const id = d.migPurge;
					this.act(id, () => post("lf/migrate-purge", { id }), () => "已删除迁移前的旧文件夹");
					return;
				}
				if (d.lf) {
					const m = (i?.memDetail ?? []).find((x) => x.key === d.lf);
					if (!m || this.sending) return;
					if (m.moveTo === null && i?.folder && !i.folder.value && this.needFolder({
						kind: "key",
						key: m.key
					})) return;
					this.sendLf(m.key, m.key, "落盘项目 " + m.key, "已在本会话发出「落盘项目 " + m.key + "」" + (m.moveTo ? "（落盘时迁到 " + m.moveTo + "）" : ""));
					return;
				}
				if (d.merge !== void 0) {
					this.mg = {
						sel: new Set((i?.memDetail ?? []).filter((x) => x.found).map((x) => x.key)),
						name: "",
						touched: false,
						pv: null,
						err: "",
						seq: 0,
						busy: false
					};
					this.open = true;
					this.render();
					this.schedulePreview();
					reveal(this.root.querySelector("#dpmMg"));
					return;
				}
				if (d.selAll !== void 0 && this.mg) {
					for (const x of i?.memDetail ?? []) if (x.found) this.mg.sel.add(x.key);
					this.schedulePreview();
					return;
				}
				if (d.selNone !== void 0 && this.mg) {
					this.mg.sel.clear();
					this.schedulePreview();
					return;
				}
				if (d.mgCancel !== void 0) {
					this.mg = null;
					this.render();
					return;
				}
				if (d.mgGo !== void 0 && this.mg && this.mg.pv) {
					this.startMerge();
					return;
				}
				if (d.mgAbort) {
					if (!window.confirm("取消这次合并？还没提交，落盘项目和关联都不会变。")) return;
					this.act(d.mgAbort, () => post("merge/cancel", { id: d.mgAbort }), () => "已取消合并");
					return;
				}
				if (d.fold) {
					const v = t.getAttribute("aria-expanded") === "true";
					this.fold.set(d.fold, v);
					this.root.querySelector("#dpm-dn-" + CSS.escape(d.fold))?.classList.toggle("open", !v);
					t.setAttribute("aria-expanded", String(!v));
					return;
				}
				if (d.exp) {
					this.shut.set(d.exp, !(this.shut.get(d.exp) ?? false));
					this.render();
					return;
				}
				if (d.purge || d.subDel) {
					this.ask.add(d.purge || d.subDel);
					this.render();
					reveal(this.root.querySelector(".ask"));
					return;
				}
				if (d.askNo) {
					this.ask.delete(d.askNo);
					this.render();
					return;
				}
				if (d.purgeYes) {
					const id = d.purgeYes;
					this.act(id, () => post("merge/purge", { id }), (r) => "已永久删除合并前的 " + r.removed + " 个落盘项目；其他合并不受影响");
					return;
				}
				if (d.mgUndo) {
					const id = d.mgUndo;
					this.act(id, () => post("merge/undo", { id }), (r) => "已撤销：回到合并前的 " + r.restored.length + " 个落盘项目" + (r.refsBack.length ? "，外部引用改回 " + r.refsBack.length + " 处" : "") + (r.refsSkipped?.length ? "（" + r.refsSkipped.length + " 处合并后被改过，没动）" : ""));
					return;
				}
			};
			async startMerge() {
				const m = this.mg;
				if (!m || m.busy) return;
				m.busy = true;
				this.fillMg();
				try {
					const r = await post("merge/start", {
						sessionId: this.sid,
						keys: [...m.sel],
						name: m.name
					});
					try {
						await this.host.send(this.sid, r.prompt);
					} catch (e) {
						await post("merge/cancel", { id: r.id }).catch(() => void 0);
						throw e;
					}
					this.mg = null;
					this.wasMerging = r.id;
					this.host.toast("已在本会话发出合并指令（" + m.sel.size + " 个 → " + r.key + "）");
					await this.load(true);
				} catch (e) {
					m.busy = false;
					m.err = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
					this.fillMg();
					this.host.toast("开始合并失败：" + m.err, "err");
				}
			}
			async copy(btn, text, what) {
				try {
					await navigator.clipboard.writeText(text);
				} catch (e) {
					this.host.toast("复制失败：" + (e instanceof Error ? e.message : String(e)), "err");
					return;
				}
				btn.classList.add("copied");
				this.host.toast("已复制" + what + "：" + text);
				setTimeout(() => btn.classList.remove("copied"), 1200);
			}
			rawFrom = null;
			raw = null;
			async openRaw(from) {
				this.rawFrom = from;
				try {
					this.raw = await getRaw(this.sid);
				} catch (e) {
					this.host.toast("读取原文失败：" + (e instanceof Error ? e.message : String(e)), "err");
					return;
				}
				this.rawTab = "sys";
				this.paintRaw();
			}
			rawText() {
				const r = this.raw;
				return this.rawTab === "sys" ? [r.rules, r.system].filter(Boolean).join("\n\n") : r.files.map((f) => f.text).join("\n\n");
			}
			paintRaw() {
				const r = this.raw;
				if (!r || this.dead) return;
				const sys = [r.rules, r.system].filter(Boolean).join("\n\n");
				const sum = r.files.reduce((n, f) => n + f.chars, 0);
				const tabs = "<div class=\"tabs\" role=\"tablist\"><button type=\"button\" role=\"tab\" id=\"dpmRawTab-sys\" data-raw-tab=\"sys\" aria-selected=\"" + (this.rawTab === "sys") + "\" aria-controls=\"dpmRawBody\">系统提示<span class=\"c\">" + sys.length + " 字 · 每一步</span></button><button type=\"button\" role=\"tab\" id=\"dpmRawTab-inj\" data-raw-tab=\"inj\" aria-selected=\"" + (this.rawTab === "inj") + "\" aria-controls=\"dpmRawBody\">落盘项目全文<span class=\"c\">" + r.files.length + " 份" + (r.files.length ? " · " + wan(sum) : "") + " · 有新版才发</span></button></div>";
				const body = this.rawTab === "sys" ? "<p class=\"hint\">AI 每一步都会收到这一段（常驻规则 + 本卡片的卡片档案与落盘项目索引）。卡片资料在看板上一改，下一步就是新的。</p><pre class=\"raw\">" + esc(sys) + "</pre>" : r.files.length ? "<p class=\"hint\">每份只在版本变化时发给 AI 一次（同一版本不重发），上下文被压缩后重发。下面是当前版本的全文（与注入时的文本一致，本卡片的档案块换成了占位行）。</p>" + r.files.map((f, k) => "<details class=\"inj\"" + (k ? "" : " open") + "><summary>" + ic("chev") + "<b>" + esc(f.key + (f.file === "STATE.md" ? "" : " · " + f.file)) + "</b><span class=\"tag\">" + esc(f.version) + "</span><span class=\"sp\"></span><span class=\"m\">" + esc(wan(f.chars)) + " · " + (f.inContext ? "已在本会话" : "下一步注入") + "</span></summary><pre class=\"raw\">" + esc(f.text) + (f.truncated ? "\n…（还有 " + f.truncated + " 字，浮层里省略）" : "") + "</pre></details>").join("") : "<p class=\"hint\">本卡片还没有关联落盘项目，AI 只收到「系统提示」那一段。</p>";
				let ov = this.ov;
				if (!ov) {
					ov = document.createElement("div");
					ov.className = "dpm-ov";
					ov.addEventListener("mousedown", (e) => {
						if (e.target === ov) this.closeRaw();
					});
					ov.addEventListener("keydown", (e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							this.closeRaw();
						}
					});
					ov.addEventListener("click", (e) => {
						const b = e.target.closest("button");
						if (!b) return;
						if (b.dataset.rawTab) {
							this.rawTab = b.dataset.rawTab;
							this.paintRaw();
							ov.querySelector("#dpmRawTab-" + this.rawTab)?.focus();
							return;
						}
						if (b.dataset.rawClose !== void 0) return this.closeRaw();
						if (b.dataset.rawCopy !== void 0) navigator.clipboard.writeText(this.rawText()).then(() => this.host.toast(this.rawTab === "sys" ? "已复制系统提示原文" : "已复制落盘项目全文"), (x) => this.host.toast("复制失败：" + String(x), "err"));
					});
					document.body.append(ov);
					this.ov = ov;
				}
				ov.innerHTML = "<div class=\"dlg\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"dpmRawT\"><div class=\"dlg-h\"><div style=\"flex:1;min-width:0\"><h2 id=\"dpmRawT\">AI 收到的原文</h2><p>" + esc((this.info?.card?.group ?? "") + " / " + (this.info?.card?.title ?? "")) + " · 和插件发给 AI 的文本逐字一致</p></div><button type=\"button\" class=\"ib\" data-raw-close aria-label=\"关闭\" title=\"关闭（Esc）\">" + ic("x") + "</button></div>" + tabs + "<div class=\"dlg-b\" id=\"dpmRawBody\" role=\"tabpanel\" aria-labelledby=\"dpmRawTab-" + this.rawTab + "\">" + body + "</div><div class=\"dlg-f\"><span class=\"meta\">约 " + tok(this.rawText()).toLocaleString() + " token</span><button type=\"button\" class=\"btn sm\" data-raw-copy>复制全文</button><button type=\"button\" class=\"btn sm\" data-raw-close>关闭</button></div></div>";
				if (!ov.contains(document.activeElement)) ov.querySelector("[data-raw-close]").focus();
			}
			closeRaw() {
				const ov = this.ov;
				if (!ov) return;
				this.ov = null;
				ov.classList.add("out");
				setTimeout(() => ov.remove(), 160);
				this.rawFrom?.focus();
			}
		};
		/** 悬停走马灯：只在文字被截断且鼠标悬停时跑，离开即复原；减少动效时改成悬停提示。挂在 document 上，返回卸载函数。 */
		function marquee(scope) {
			const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
			const over = (e) => {
				const el = e.target.closest?.(scope);
				if (!el || el.dataset.mq !== void 0 || el.children.length) return;
				if (el.scrollWidth <= el.clientWidth + 1) return;
				const txt = el.textContent ?? "";
				if (reduce()) {
					if (!el.title) el.title = txt;
					return;
				}
				el.dataset.mq = txt;
				el.classList.add("mq-on");
				el.style.setProperty("--mq-dur", Math.max(4, txt.length * .22) + "s");
				el.innerHTML = "<span class=\"mq-track\"><span>" + esc(txt) + "</span><span aria-hidden=\"true\">" + esc(txt) + "</span></span>";
				const leave = () => {
					if (el.dataset.mq !== void 0) el.textContent = el.dataset.mq;
					delete el.dataset.mq;
					el.classList.remove("mq-on");
					el.style.removeProperty("--mq-dur");
					el.removeEventListener("mouseleave", leave);
				};
				el.addEventListener("mouseleave", leave);
			};
			document.addEventListener("mouseover", over);
			return () => document.removeEventListener("mouseover", over);
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
				if (creating) {
					toast("正在新建会话，稍等一下");
					return;
				}
				creating = true;
				closeNs();
				boardView?.setCreating(cardId);
				const card = live.snap?.board.cards.find((c) => c.id === cardId);
				const gws = card ? live.snap?.hub.groups?.[card.g] : void 0;
				if (gws && card) bridge.setPending({
					ws: gws,
					title: card.t
				});
				try {
					const { workspaceId, workspaceTitle } = await post("session/prepare", { cardId });
					if (!gws && card) bridge.setPending({
						ws: workspaceId,
						title: card.t
					});
					const sessionId = await ctx.sessions.create({ workspaceId });
					const r = await post("session/bind", {
						sessionId,
						cardId,
						tree: treeMode()
					});
					await live.refresh().catch(() => void 0);
					bridge.setPending(null);
					openAndReveal(sessionId, workspaceId);
					toast("已在「" + workspaceTitle + "」新建" + (r.title ? "「" + r.title + "」" : "会话") + (r.permission ? " · 完全权限" : ""));
				} catch (e) {
					bridge.setPending(null);
					toast("新建项目会话失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				} finally {
					creating = false;
					boardView?.setCreating(null);
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
				pickCard: (a, g) => void pickCard(a, g),
				open: (id) => ctx.uiWorkspace.openSession(id),
				canDelete: () => canDelete,
				del: (id, title) => void deleteSession(id, title)
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
			const DSM = "/dsh-manage-sessions";
			let canDelete = false;
			ctx.effect(() => {
				let dead = false;
				fetch(DSM + "/capabilities", { cache: "no-store" }).then((r) => r.json()).then((b) => {
					if (dead || !(b?.ok && b.capabilities?.delete)) return;
					canDelete = true;
					for (const f of live.subs) f();
				}).catch(() => {});
				return () => {
					dead = true;
					canDelete = false;
				};
			}, "dsh-project-manager: delete capability");
			const DEL_HINT = {
				blocked: "会话正在运行或被别的窗口占用，先停止再删",
				"capability-missing": "当前 DSH 不支持删除会话（dsh-manage-sessions 缺少宿主能力）",
				"unknown-session": "会话已经不存在了"
			};
			let delDlg = null;
			const closeDel = () => {
				if (delDlg?.open) delDlg.close("");
				delDlg?.remove();
				delDlg = null;
			};
			ctx.effect(() => closeDel, "dsh-project-manager: delete dialog");
			const doDelete = async (id, title) => {
				const s = ctx.sessions.list.getSnapshot().byId[id];
				if (!s) {
					toast("会话「" + title + "」已经不存在了", "err");
					return false;
				}
				if (!s.blank) {
					toast("「" + title + "」已经有对话了，不能删除，可以归档", "err");
					return false;
				}
				let r;
				try {
					r = await (await fetch(DSM + "/delete", {
						method: "POST",
						credentials: "same-origin",
						cache: "no-store",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ ids: [id] })
					})).json();
				} catch (e) {
					toast("删除「" + title + "」失败：连不上 dsh-manage-sessions（" + String(e) + "）", "err");
					return false;
				}
				if (!r?.ok) {
					const c = r?.error?.code ?? "";
					toast("删除「" + title + "」失败：" + (DEL_HINT[c] ?? r?.error?.message ?? "未知错误") + (c ? "（" + c + "）" : ""), "err");
					return false;
				}
				if (live.snap?.board.sessions.some((x) => x.sessionId === id)) try {
					await post("session/unlink", { sessionId: id });
				} catch (e) {
					toast("会话已删除，但解除卡片关联失败：" + (e instanceof ApiError ? e.message : String(e)), "err");
				}
				live.refresh();
				toast("已删除「" + title + "」");
				return true;
			};
			/** 确认后删除；返回是否真的删了（取消 / 失败 = false）。 */
			const deleteSession = (id, title) => new Promise((done) => {
				closeDel();
				const dlg = document.createElement("dialog");
				dlg.className = "dpm-dialog";
				dlg.setAttribute("aria-labelledby", "dpmDelT");
				dlg.innerHTML = "<form method=\"dialog\"><div class=\"dlg-h\"><h2 id=\"dpmDelT\">删除「" + esc(title) + "」？</h2><p>这个会话还没有对话。删除后会从 DSH 里彻底移除（会话文件一起删掉），不能恢复。</p></div><div class=\"dlg-f\"><span class=\"sp\"></span><button class=\"btn\" type=\"submit\" value=\"\">取消</button><button class=\"btn primary danger-fill\" type=\"submit\" value=\"ok\" data-del-ok>" + ic("trash") + "删除</button></div></form>";
				document.body.append(dlg);
				delDlg = dlg;
				dlg.addEventListener("close", () => {
					const ok = dlg.returnValue === "ok";
					if (delDlg === dlg) {
						delDlg = null;
						dlg.remove();
					}
					if (!ok) {
						done(false);
						return;
					}
					doDelete(id, title).then(done);
				});
				dlg.showModal();
				dlg.querySelector("button[value=\"\"]")?.focus();
			});
			ctx.effect(() => {
				const tried = /* @__PURE__ */ new Set();
				let busy = false;
				const run = () => {
					const snap = live.snap;
					if (busy || !snap) return;
					const refs = new Set(snap.board.sessions.map((s) => s.sessionId));
					const byId = ctx.sessions.list.getSnapshot().byId;
					const pairs = [];
					for (const [id, s] of Object.entries(byId)) {
						if (!s || s.origin === "subagent" || !s.parentId || s.parentId === id || tried.has(id) || refs.has(id) || !refs.has(s.parentId)) continue;
						pairs.push({
							child: id,
							parent: s.parentId
						});
					}
					if (!pairs.length) return;
					for (const p of pairs) tried.add(p.child);
					busy = true;
					post("session/fork-backfill", { pairs }).then((r) => {
						if (r.result.bound.length) {
							live.snap = r;
							for (const f of live.subs) f();
						}
					}).catch((e) => console.warn("[dsh-project-manager] 分叉会话补关联失败：", pairs, e)).finally(() => {
						busy = false;
					});
				};
				const a = ctx.sessions.list.subscribe(run);
				live.subs.add(run);
				run();
				return () => {
					a();
					live.subs.delete(run);
				};
			}, "dsh-project-manager: fork backfill");
			ctx.effect(() => {
				let raf = 0;
				const paint = () => {
					raf = 0;
					const h = live.snap?.hub;
					if (!h) {
						bridge.setBlanks({});
						return bridge.paint(null, {});
					}
					const ws = ctx.workspaces.list.getSnapshot();
					const arch = new Set(ws.archivedSessionIds ?? []);
					const byId = ctx.sessions.list.getSnapshot().byId;
					const counts = {};
					for (const wid of Object.values(h.groups ?? {})) counts[wid] = (ws.items.find((x) => x.workspaceId === wid)?.sessionIds ?? []).filter((id) => !arch.has(id) && byId[id] !== void 0 && byId[id].origin !== "subagent").length;
					bridge.paint(h.workspaceId ?? null, counts);
					const titles = {};
					for (const r of live.snap?.board.sessions ?? []) titles[r.sessionId] = r.title;
					bridge.setBlanks(blankRows(ws.items, byId, arch, [...h.workspaceId ? [h.workspaceId] : [], ...Object.values(h.groups ?? {})], titles));
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
			let boardView = null;
			let pendingCard = null;
			const openBoardAt = (cardId) => {
				pendingCard = cardId;
				ctx.layout.selectPanel(PANEL);
				if (boardView) {
					boardView.focusCard(cardId);
					pendingCard = null;
				}
			};
			const Board = (props) => {
				const ref = (0, react.useRef)(null);
				const [, bump] = (0, react.useState)(0);
				(0, react.useEffect)(() => {
					const el = ref.current;
					if (!el) return;
					let vref = null;
					const view = new BoardView(el, {
						newSession,
						openSession: (id) => openAndReveal(id),
						isDark,
						setDark,
						toast,
						pickCard: (a, g) => void pickCard(a, g),
						canDeleteSession: () => canDelete,
						seed: () => live.snap,
						deleteSession,
						sendToCard: async (cardId, text) => {
							const s = ctx.sessions;
							if (typeof s.using !== "function") throw new Error("当前 dsh 版本不能从看板给会话发消息（sessions.using 不存在）");
							const snap = live.snap ?? await getState();
							const arch = new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []);
							const byId = s.list.getSnapshot().byId;
							let id = snap.board.sessions.filter((r) => r.cardId === cardId && byId[r.sessionId] && !arch.has(r.sessionId)).map((r) => r.sessionId).sort((a, b) => (byId[b]?.updatedAt ?? 0) - (byId[a]?.updatedAt ?? 0))[0];
							let ws;
							if (!id) {
								const p = await post("session/prepare", { cardId });
								id = await s.create({ workspaceId: p.workspaceId });
								await post("session/bind", {
									sessionId: id,
									cardId,
									tree: treeMode()
								});
								ws = p.workspaceId;
							}
							const r = await s.using(id, { source: "dsh-project-manager" }, (ref) => ref.binding.session.prompt([{
								type: "text",
								text
							}], "queue"));
							if (!r.ok) throw new Error((r.error?.message ?? "发送失败") + (r.error?.code ? "（" + r.error.code + "）" : ""));
							openAndReveal(id, ws);
							live.refresh();
							const v = s.list.getSnapshot().byId[id];
							return v?.title || v?.displayTitle || "新会话";
						},
						allSessions: () => {
							const ws = ctx.workspaces.list.getSnapshot();
							const arch = new Set(ws.archivedSessionIds ?? []);
							const owner = /* @__PURE__ */ new Map();
							const hubPath = (vref ?? live).snap?.hub.path;
							for (const w of ws.items) for (const id of w.sessionIds ?? []) owner.set(id, {
								title: w.path === hubPath ? HUB_TITLE : w.title,
								id: w.workspaceId
							});
							const st = ctx.sessions.list.getSnapshot();
							const out = [];
							for (const id of st.ids) {
								const s = st.byId[id];
								if (!s || s.origin === "subagent") continue;
								const o = owner.get(id);
								const fork = s.parentId && s.parentId !== id ? st.byId[s.parentId] : void 0;
								out.push({
									id,
									...s.parentId && s.parentId !== id ? { forkOf: fork ? fork.title || fork.displayTitle || s.parentId : "已删除的会话" } : {},
									blank: !!s.blank,
									title: s.title || (s.blank ? "新会话" : s.displayTitle) || id,
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
					vref = view;
					boardView = view;
					if (pendingCard) {
						view.focusCard(pendingCard);
						pendingCard = null;
					}
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
						if (boardView === view) boardView = null;
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
			const liveSess = (id) => {
				const s = ctx.sessions.list.getSnapshot().byId[id];
				return !!s && s.origin !== "subagent" && !(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? []).includes(id);
			};
			const doing = () => live.snap ? doingCount(live.snap.board, liveSess) : 0;
			const Entry = (p) => {
				const [n, setN] = (0, react.useState)(doing);
				(0, react.useEffect)(() => {
					const f = () => setN(doing());
					live.subs.add(f);
					const a = ctx.sessions.list.subscribe(f);
					const b = ctx.workspaces.list.subscribe(f);
					f();
					return () => {
						live.subs.delete(f);
						a();
						b();
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
			const sendTo = async (id, text) => {
				const s = ctx.sessions;
				if (typeof s.using !== "function") throw new Error("当前 dsh 版本不能从界面给会话发消息（sessions.using 不存在）");
				const r = await s.using(id, { source: "dsh-project-manager" }, (ref) => ref.binding.session.prompt([{
					type: "text",
					text
				}], "queue"));
				if (!r.ok) throw new Error((r.error?.message ?? "发送失败") + (r.error?.code ? "（" + r.error.code + "）" : ""));
			};
			const Dock = (props) => {
				const viaHook = props.useSession ? props.useSession((s) => s?.id ?? s?.sessionId) : void 0;
				const sessionId = props.sessionId ?? viaHook;
				const ref = (0, react.useRef)(null);
				(0, react.useEffect)(() => {
					const el = ref.current;
					if (!el || !sessionId) return;
					const card = new SessionCard(el, sessionId, {
						toast,
						send: sendTo,
						openBoard: (cardId) => openBoardAt(cardId)
					});
					return () => card.dispose();
				}, [sessionId]);
				return (0, react.createElement)("div", {
					ref,
					hidden: true
				});
			};
			ctx.effect(() => ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "dsh-project-manager:memory",
				order: 30
			}, Dock)), "dsh-project-manager: memory dock");
			ctx.effect(() => marquee(".dpm-sic .mq, .dpm .detail .mq"), "dsh-project-manager: marquee");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.treeMode = treeMode;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map