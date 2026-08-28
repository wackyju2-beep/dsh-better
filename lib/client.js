/**
 * dsh-better — browser half.
 *
 * Hand-written __ModuleLoader__ bundle (no build step): a "更好的 DSH" settings
 * section with five pages — archived-session management (restore/delete through
 * the host half's loopback endpoints), task-stop desktop notifications via the
 * Web Notifications API (real Windows toasts while the GUI page is open), an
 * update checker comparing the installed dsh against GitHub releases with a
 * copyable rebuild command list plus a one-click console window at the
 * discovered checkout root, model routing: keyword rules that switch the
 * session model, an allowlist-gated model_route agent tool, and a status
 * overview — edited against the host half's policy endpoints, and a
 * chat.deepseek.com-style message scroll nav: one small tick line per user
 * message floating at the conversation's right edge, hover previews the
 * message text, click jumps to it, colors customizable in its settings page.
 *
 * The notification engine observes the session runtime's frame entry points by
 * wrapping its prototype methods (call-through first-class: observers never
 * alter dispatch), so option texts, stop reasons, and agent errors are read
 * from the same frames the sidebar already consumes. The scroll nav reads the
 * current session's ConversationSnapshot through sessions.binding(id).session
 * and jumps by scrolling `[data-conversation-scroll]` onto the row carrying
 * the matching `data-chat-anchor-key`.
 */
window.__ModuleLoader__.load({
	id: "dsh-better",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const p = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region css
		let styleTag;
		function ensureCss() {
			if (styleTag !== undefined) return;
			styleTag = document.createElement("style");
			styleTag.setAttribute("data-plugin", "dsh-better");
			styleTag.textContent = CSS_TEXT + UPDATE_CSS_TEXT + ROUTER_CSS_TEXT + SCROLLNAV_CSS_TEXT;
			document.head.appendChild(styleTag);
		}
		const CSS_TEXT = ".dtb_page{display:flex;flex-direction:column;gap:4px;padding:2px 0 12px}\n.dtb_back{cursor:pointer;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:8px;align-items:center;gap:6px;padding:6px 8px 6px 4px;font:inherit;font-size:13px;line-height:20px;display:inline-flex;width:fit-content}\n.dtb_back:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}\n.dtb_title{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:24px;margin:2px 0 10px}\n.dtb_intro{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0 0 10px}\n.dtb_entries{flex-direction:column;gap:8px;display:flex}\n.dtb_entry{cursor:pointer;text-align:left;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l1,transparent);border-radius:12px;align-items:center;gap:12px;padding:14px;font:inherit;display:flex;width:100%;transition:border-color .15s ease}\n.dtb_entry:hover{border-color:var(--dsw-alias-border-l1)}\n.dtb_entryIcon{width:36px;height:36px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-l2);border-radius:10px;justify-content:center;align-items:center;display:flex;flex:none}\n.dtb_entryMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}\n.dtb_entryName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}\n.dtb_entryDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}\n.dtb_entryChevron{color:var(--dsw-alias-label-caption);flex:none;display:flex}\n.dtb_rows{flex-direction:column;gap:6px;display:flex}\n.dtb_row{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l1,transparent);border-radius:12px;align-items:center;gap:10px;padding:10px 12px;display:flex}\n.dtb_rowIcon{color:var(--dsw-alias-label-tertiary);flex:none;display:flex}\n.dtb_rowMain{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}\n.dtb_rowTitle{color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}\n.dtb_rowSub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}\n.dtb_more{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none}\n.dtb_more:hover,.dtb_more[data-open]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}\n.dtb_empty{color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;justify-content:center;align-items:center;gap:8px;padding:28px 16px;font-size:12px;line-height:18px;display:flex}\n.dtb_note{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:8px;margin:6px 0 0;padding:7px 10px;font-size:12px;line-height:18px}\n.dtb_oknote{color:var(--dsw-alias-state-success-primary)}\n.dtb_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l1,transparent);border-radius:12px;flex-direction:column;gap:10px;padding:12px;display:flex;margin:0 0 10px}\n.dtb_switchRow{align-items:center;gap:10px;display:flex}\n.dtb_switchText{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}\n.dtb_switchLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:19px}\n.dtb_switchDesc{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}\n.dtb_track{cursor:pointer;width:36px;height:20px;background:var(--dsw-alias-fill-l3);border-radius:999px;position:relative;transition:background .15s ease;flex:none;border:none;padding:0}\n.dtb_track[data-on='true']{background:#1a1a1a}\n.dtb_thumb{width:16px;height:16px;background:#fff;border-radius:50%;position:absolute;top:2px;left:2px;transition:left .15s ease;box-shadow:0 1px 3px rgba(0,0,0,.25)}\n.dtb_track[data-on='true'] .dtb_thumb{left:18px}\n.dtb_check{cursor:pointer;align-items:center;gap:8px;padding:4px 0;font:inherit;font-size:13px;line-height:19px;color:var(--dsw-alias-label-primary);background:0 0;border:none;display:flex;width:100%;text-align:left;border-radius:6px}\n.dtb_check:hover{background:var(--dsw-alias-interactive-bg-hover)}\n.dtb_box{width:16px;height:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;justify-content:center;align-items:center;display:flex;flex:none;color:#fff}\n.dtb_box[data-on='true']{background:#1a1a1a;border-color:#1a1a1a}\n.dtb_perm{align-items:center;gap:8px;display:flex;flex-wrap:wrap}\n.dtb_pill{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-l2);border-radius:999px;padding:2px 9px;font-size:11px;line-height:17px}\n.dtb_btn{cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;line-height:18px}\n.dtb_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}\n.dtb_spin{color:var(--dsw-alias-label-tertiary);justify-content:center;padding:18px;display:flex}";
		const UPDATE_CSS_TEXT = ".dtb_kv{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border-top:1px solid var(--dsw-alias-border-l2)}\n.dtb_kv:first-child{border-top:none}\n.dtb_kvLabel{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;flex:none}\n.dtb_kvValue{color:var(--dsw-alias-label-primary);font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;text-align:right;word-break:break-all;min-width:0}\n.dtb_statusRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:2px 0 12px}\n.dtb_dot{width:8px;height:8px;border-radius:50%;flex:none}\n.dtb_actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}\n.dtb_codeWrap{position:relative;margin-top:10px}\n.dtb_code{margin:0;padding:34px 96px 12px 12px;background:var(--dsw-alias-fill-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;font-size:12px;line-height:19px;white-space:pre-wrap;word-break:break-all;user-select:all}\n.dtb_copyBtn{position:absolute;top:8px;right:8px}\na.dtb_btn{text-decoration:none;display:inline-flex;align-items:center;justify-content:center}\n.dtb_btn[disabled]{opacity:.5;cursor:not-allowed}\n";
		const ROUTER_CSS_TEXT = ".dtb_mr_rule,.dtb_mr_allowEntry{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-l1,transparent);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;margin-top:8px}\n.dtb_mr_ruleTop{display:flex;align-items:center;gap:10px;flex-wrap:wrap}\n.dtb_mr_index{width:22px;height:22px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-fill-l2);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;flex:none}\n.dtb_mr_spacer{flex:1}\n.dtb_mr_grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:10px}\n.dtb_mr_grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}\n.dtb_mr_field{display:flex;flex-direction:column;gap:4px;min-width:0}\n.dtb_mr_field>span{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}\n.dtb_mr_field input,.dtb_mr_field select{box-sizing:border-box;width:100%;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-l2,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;outline:none;transition:border-color .15s ease}\n.dtb_mr_field input:focus-visible,.dtb_mr_field select:focus-visible{border-color:var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}\n.dtb_mr_field input::placeholder{color:var(--dsw-alias-label-caption)}\n.dtb_mr_hint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}\n.dtb_mr_pills{display:flex;flex-wrap:wrap;align-items:center;gap:6px}\n.dtb_mr_badgeWarn{color:#986818;background:rgba(224,162,55,.12)}\n.dtb_mr_badgeErr{color:var(--dsw-alias-state-error-primary,#b5443f);background:rgba(205,72,72,.1)}\n.dtb_mr_validBadge,.dtb_mr_invalidBadge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:650;padding:3px 9px;border-radius:999px;white-space:nowrap}\n.dtb_mr_validBadge{color:#267d52;background:rgba(48,154,100,.12)}\n.dtb_mr_validBadge::before{content:\'\';width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}\n.dtb_mr_invalidBadge{color:#986818;background:rgba(224,162,55,.13)}\n.dtb_mr_invalidBadge::before{content:\'\';width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}\n.dtb_mr_card[data-state=running] .dtb_rowSub{color:var(--dsw-alias-label-caption)}\n.dtb_mr_card[data-state=error]{border-color:rgba(205,72,72,.35)}\n.dtb_mr_card[data-state=error] .dtb_rowSub{color:var(--dsw-alias-state-error-primary,#b5443f)}\n.dtb_mr_btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:13px;font-weight:600;line-height:20px;padding:6px 14px;border:1px solid transparent;border-radius:8px;cursor:pointer;color:#fff;background:#1a1a1a;transition:background .15s ease,opacity .15s ease}\n.dtb_mr_btn:hover{background:#333}\n.dtb_mr_btn:disabled,.dtb_mr_btn[disabled]{opacity:.5;cursor:not-allowed}\n.dtb_mr_btnGhost{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:13px;font-weight:500;line-height:20px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-l1,transparent);transition:border-color .15s ease,background .15s ease}\n.dtb_mr_btnGhost:hover{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-fill-l2)}\n.dtb_mr_btnGhost:disabled,.dtb_mr_btnGhost[disabled]{opacity:.5;cursor:not-allowed}\n.dtb_mr_btnDanger{color:var(--dsw-alias-state-error-primary,#b5443f)}\n.dtb_mr_btnDanger:hover{background:rgba(205,72,72,.1)}\n@media(max-width:720px){.dtb_mr_grid,.dtb_mr_grid3{grid-template-columns:1fr}}\n";
		// Message scroll nav (v0.5.0) — faithful port of chat.deepseek.com's
		// scroll-nav (classes reverse-engineered from its production stylesheet):
		// a fixed 34x300px hit area with a blurred pill track (light: white .8 /
		// dark: rgba(21,21,23,.6)); hovering lights up a 240px-wide popover panel
		// (--dsw-alias-bg-layer-1 + --dsw-shadow-lv3 + inverted border) whose rows
		// pair one message label with one tick line; the row at the current
		// viewport gets the brand-colored enlarged active tick; the list scrolls
		// under 32px gradient fades when it overflows. Every default rides
		// --dsw-* theme tokens so light/dark follow the app theme; explicit user
		// colors inject as inline --dtb-sn-* variables which win over both.
		// Message scroll nav (v0.5.x) — faithful port of chat.deepseek.com's scroll-nav:
		// fixed 34x300 hit area, blurred pill track (light white .8 / dark rgba(21,21,23,.6)),
		// hover popover panel (--dsw-alias-bg-layer-1 + lv3 shadow), one label+tick pair per
		// user message, brand-colored enlarged tick on the message currently in view, gradient
		// fades over the scrollable edges. Theme colors use light-dark() so they follow the
		// app color-scheme directly (the body attribute flag is only set at boot); explicit
		// user colors inject as inline --dtb-sn-* variables which win over everything.
		const SCROLLNAV_CSS_TEXT = ".dtb_sn{position:fixed;right:16px;top:50%;bottom:50%;transform:translateY(-50%);width:34px;height:300px;z-index:70;display:flex;align-items:center;user-select:none;-webkit-user-select:none}\n"
		 + ".dtb_sn_track{position:absolute;top:50%;right:0;transform:translateY(-50%);width:34px;height:calc(100% - 8px);max-height:calc(100% - 8px);border-radius:16px;background:var(--dtb-sn-track,light-dark(rgba(255,255,255,.8),rgba(21,21,23,.6)));backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);z-index:0}\n"
		 + ".dtb_sn_panel{position:absolute;right:0;top:auto;bottom:auto;width:240px;max-width:240px;max-height:100%;display:flex;flex-direction:column;align-items:stretch;border-radius:16px;border:1px solid transparent;overflow:hidden;pointer-events:none;transition:background .2s,box-shadow .2s,border-color .2s}\n"
		 + ".dtb_sn[data-open='1'] .dtb_sn_panel{pointer-events:auto;background:var(--dtb-sn-panel,light-dark(#fff,#232324));box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 rgba(0,0,0,.2),0 0 4px 0 rgba(0,0,0,.02),0 12px 32px 0 rgba(0,0,0,.08));border-color:light-dark(transparent,rgba(255,255,255,.06))}\n"
		 + ".dtb_sn_fade{position:absolute;left:0;width:100%;height:32px;z-index:2;pointer-events:none;opacity:0;transition:opacity .2s;background:linear-gradient(180deg,var(--dtb-sn-panel,light-dark(#fff,#232324)) 20.19%,light-dark(rgba(255,255,255,0),rgba(35,35,36,0)) 100%)}\n"
		 + ".dtb_sn_fadeBottom{top:auto;bottom:0;transform:rotate(180deg)}\n"
		 + ".dtb_sn[data-open='1'] .dtb_sn_fade[data-show='1']{opacity:1}\n"
		 + ".dtb_sn_list{display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;padding:8px 0 8px 20px;min-height:0}\n"
		 + ".dtb_sn_list::-webkit-scrollbar{display:none}\n"
		 + ".dtb_sn_row:first-child{margin-top:auto}\n"
		 + ".dtb_sn_row:last-child{margin-bottom:auto}\n"
		 + ".dtb_sn_row{cursor:pointer;height:30px;line-height:20px;display:flex;justify-content:flex-end;align-items:center;width:calc(100% - 6px);margin-right:8px;color:var(--dtb-sn-label,light-dark(#81858c,#adb2b8))}\n"
		 + ".dtb_sn_row:hover{color:var(--dtb-sn-hover,light-dark(#0f1115,#f9fafb))}\n"
		 + ".dtb_sn_label{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin-right:12px;opacity:0;transition:opacity .1s,color .2s;text-align:left}\n"
		 + ".dtb_sn[data-open='1'] .dtb_sn_label{opacity:1}\n"
		 + ".dtb_sn_tickHolder{flex-shrink:0;width:16px;height:20px;display:flex;justify-content:center;align-items:center}\n"
		 + ".dtb_sn_tick{flex-shrink:0;width:8px;height:2px;border-radius:4px;background:var(--dtb-sn-tick,light-dark(rgba(0,0,0,.16),rgba(255,255,255,.2)));transition:background-color .2s}\n"
		 + ".dtb_sn_row:hover .dtb_sn_tick{background:var(--dtb-sn-hover,light-dark(#0f1115,#f9fafb))}\n"
		 + ".dtb_sn_row[data-active='1']{color:var(--dtb-sn-active,light-dark(#3964fe,#679efe))}\n"
		 + ".dtb_sn_row[data-active='1'] .dtb_sn_label{font-weight:500;color:inherit}\n"
		 + ".dtb_sn_row[data-active='1'] .dtb_sn_tick{background:var(--dtb-sn-active,light-dark(#3964fe,#679efe));transform-origin:50%;transform:scale(1.5)}\n"
		 + ".dtb_sn_colorRow{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l2)}\n"
		 + ".dtb_sn_colorRow:first-child{border-top:none}\n"
		 + ".dtb_sn_colorRow>span:first-child{flex:1;text-align:left}\n"
		 + ".dtb_sn_color{width:36px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;cursor:pointer}\n"
		 + ".dtb_sn_range{width:140px;accent-color:#4d6bfe}\n"
		 + ".dtb_sn_hex{font-family:ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);min-width:56px;text-align:right}\n";
		//#endregion
		//#endregion

		//#region whale mark (exact FishLogo geometry from dsh-client-ui-primitives, for the OS toast icon)
		const WHALE_VIEWBOX = "0 0 23.16 17.04";
		const WHALE_PATH = "M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z";
		let iconPromise;
		function whaleIconDataUrl() {
			if (iconPromise === undefined) {
				iconPromise = new Promise((resolve) => {
					try {
						const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + WHALE_VIEWBOX + '"><path d="' + WHALE_PATH + '" fill="#4D6BFE"/></svg>';
						const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
						const image = new Image();
						image.onload = () => {
							try {
								const canvas = document.createElement("canvas");
								canvas.width = 256; canvas.height = Math.round(256 * 17.04 / 23.16);
								const ctx = canvas.getContext("2d");
								ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
								resolve(canvas.toDataURL("image/png"));
							} catch { resolve(undefined); }
						};
						image.onerror = () => resolve(undefined);
						image.src = url;
					} catch { resolve(undefined); }
				});
			}
			return iconPromise;
		}

		function installFavicon() {
			try {
				const head = document.head;
				if (!head || head.querySelector('link[data-dsh-better-favicon]')) return true;
				for (const old of Array.from(head.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]'))) old.remove();
				const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + WHALE_VIEWBOX + '"><path d="' + WHALE_PATH + '" fill="#4D6BFE"/></svg>';
				const mk = (type, sizes, href) => {
					const link = document.createElement('link');
					link.rel = 'icon';
					if (type) link.type = type;
					if (sizes) link.sizes = sizes;
					link.href = href;
					link.setAttribute('data-dsh-better-favicon', '');
					head.appendChild(link);
				};
				mk('image/svg+xml', undefined, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
				Promise.resolve(whaleIconDataUrl()).then((png) => { if (png) mk('image/png', '256x256', png); }).catch(() => {});
				return true;
			} catch { return false; }
		}
		if (!installFavicon() && document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', installFavicon, { once: true });
		}
		//#endregion

		//#region settings store (browser-local; notifications are a per-browser affordance)
		const STORE_KEY = "dsh-better.notifications";
		function loadNotifySettings() {
			try {
				const raw = window.localStorage.getItem(STORE_KEY);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					return {
						enabled: parsed.enabled === true,
						options: parsed.options !== false,
						done: parsed.done !== false,
						error: parsed.error !== false,
					};
				}
			} catch { /* fresh store on unreadable data */ }
			return { enabled: false, options: true, done: true, error: true };
		}
		const listeners = new Set();
		let notifySettings = loadNotifySettings();
		function saveNotifySettings() {
			try { window.localStorage.setItem(STORE_KEY, JSON.stringify(notifySettings)); } catch { /* private mode: in-memory only */ }
			for (const listener of listeners) { try { listener(); } catch {} }
		}
		function updateNotifySettings(patch) {
			notifySettings = { ...notifySettings, ...patch };
			saveNotifySettings();
		}
		function subscribeNotifySettings(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
		//#endregion

		//#region scroll nav settings store (browser-local, same posture as notifications)
		const SN_STORE_KEY = "dsh-better.scrollnav";
		/**
		 * `customColors: false` (the default) renders purely through --dsw-* theme
		 * tokens so the rail follows the app's light/dark theme. Turning it on
		 * overrides every color with these explicit values in BOTH themes.
		 */
		const SN_DEFAULTS = Object.freeze({
			enabled: true,
			customColors: false,
			trackColor: "#ffffff",
			trackOpacity: 0.8,
			tickColor: "#0f1115",
			tickOpacity: 0.35,
			hoverColor: "#3964fe",
			activeColor: "#3964fe",
			labelColor: "#81858c",
			panelColor: "#ffffff",
		});
		const HEX_RE = /^#[0-9a-fA-F]{6}$/;
		function snHex(value, fallback) {
			return typeof value === "string" && HEX_RE.test(value) ? value.toLowerCase() : fallback;
		}
		function snAlpha(value, fallback) {
			const n = typeof value === "number" ? value : NaN;
			return Number.isFinite(n) ? Math.min(1, Math.max(0.05, Math.round(n * 100) / 100)) : fallback;
		}
		function sanitizeScrollNav(raw) {
			return {
				enabled: raw.enabled === true,
				customColors: raw.customColors === true,
				trackColor: snHex(raw.trackColor, SN_DEFAULTS.trackColor),
				trackOpacity: snAlpha(raw.trackOpacity, SN_DEFAULTS.trackOpacity),
				tickColor: snHex(raw.tickColor, SN_DEFAULTS.tickColor),
				tickOpacity: snAlpha(raw.tickOpacity, SN_DEFAULTS.tickOpacity),
				hoverColor: snHex(raw.hoverColor, SN_DEFAULTS.hoverColor),
				activeColor: snHex(raw.activeColor, SN_DEFAULTS.activeColor),
				labelColor: snHex(raw.labelColor, SN_DEFAULTS.labelColor),
				panelColor: snHex(raw.panelColor, SN_DEFAULTS.panelColor),
			};
		}
		function loadScrollNavSettings() {
			try {
				const raw = window.localStorage.getItem(SN_STORE_KEY);
				if (raw !== null) {
					const parsed = JSON.parse(raw);
					// v0.4 stores had explicit colors but no switch — those were the
					// pre-theme-aware defaults, not a deliberate customization, so
					// start clean on the theme-following defaults instead.
					if (parsed.customColors === undefined) return sanitizeScrollNav({ ...SN_DEFAULTS });
					return sanitizeScrollNav({ ...SN_DEFAULTS, ...parsed });
				}
			} catch { /* fresh store on unreadable data */ }
			return { ...SN_DEFAULTS };
		}
		const snListeners = new Set();
		let scrollNavSettings = loadScrollNavSettings();
		function saveScrollNavSettings() {
			try { window.localStorage.setItem(SN_STORE_KEY, JSON.stringify(scrollNavSettings)); } catch { /* private mode: in-memory only */ }
			for (const listener of snListeners) { try { listener(); } catch {} }
		}
		function updateScrollNavSettings(patch) {
			scrollNavSettings = sanitizeScrollNav({ ...scrollNavSettings, ...patch });
			saveScrollNavSettings();
		}
		function subscribeScrollNavSettings(listener) {
			snListeners.add(listener);
			return () => snListeners.delete(listener);
		}
		/** Inline CSS variables for the explicit-colors mode; empty when following the theme. */
		function scrollNavCssVars(s) {
			if (!s.customColors) return {};
			const rgba = (hex, alpha) => {
				const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
				return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
			};
			return {
				"--dtb-sn-track": rgba(s.trackColor, s.trackOpacity),
				"--dtb-sn-tick": rgba(s.tickColor, s.tickOpacity),
				"--dtb-sn-hover": s.hoverColor,
				"--dtb-sn-active": s.activeColor,
				"--dtb-sn-label": s.labelColor,
				"--dtb-sn-panel": s.panelColor,
			};
		}
		//#endregion

		//#region locale dictionaries
		const NS = "dsh-better";
		const zh = {
			"nav": "更好的 DSH",
			"back": "返回",
			"root.title": "更好的 DSH",
			"root.intro": "由 dsh-better 提供的增强设置。",
			"arch.entry": "已归档会话",
			"arch.entryDesc": "查看、复原或删除已归档的对话",
			"ntf.entry": "任务通知",
			"ntf.entryDesc": "任务停止时发送 Windows 系统通知",
			"arch.title": "已归档会话",
			"arch.intro": "这些对话已从侧边栏隐藏。复原会回到原工作区的原位置；删除会把本地存档一并删除。",
			"arch.loading": "正在读取归档…",
			"arch.empty": "没有已归档的对话",
			"arch.restore": "复原",
			"arch.delete": "删除",
			"arch.deleteTitle": "删除这个已归档对话？",
			"arch.deleteBody": "将删除本地的会话存档文件，此操作无法撤销。",
			"arch.confirmDelete": "删除",
			"arch.cancel": "取消",
			"arch.restored": "已复原，稍后会在原工作区出现",
			"arch.deleted": "已删除本地存档",
			"arch.failed": "操作失败",
			"arch.noArtifact": "无独立存档文件",
		"arch.orphan": "本地存档已不存在（残留条目）",
		"arch.more": "更多操作",
			"ntf.title": "任务通知",
			"ntf.intro": "当网页在浏览器中保持打开时，任务停止会弹出 Windows 系统通知（右下角）。",
			"ntf.enable": "启用任务通知",
			"ntf.enableDesc": "关闭页面后通知也会停止",
			"ntf.permission": "系统通知权限",
			"ntf.permDefault": "未授权",
			"ntf.permGranted": "已授权",
			"ntf.permDenied": "已被浏览器拒绝，请在浏览器地址栏权限设置中恢复",
			"ntf.permUnsupported": "当前环境不支持系统通知",
			"ntf.request": "请求授权",
			"ntf.events": "通知时机",
			"ntf.evOptions": "Agent 发来选项 / 提问时",
			"ntf.evDone": "任务完成停止时",
			"ntf.evError": "任务因错误停止时",
			"ntf.test": "发送测试通知",
			"ntf.testSent": "测试通知已发送",
			"n.title.options": "选项",
			"n.title.done": "已完成",
			"n.title.error": "错误",
			"n.body.stopped": "已停止",
			"n.body.ended": "已结束",
			"n.body.unnamed": "未命名任务",
			"upd.entry": "检查更新",
			"upd.entryDesc": "对比本机版本与 GitHub 最新发布，附更新命令",
			"upd.title": "检查更新",
			"upd.intro": "读取本机 dsh 安装信息，并与 GitHub Releases 上的最新发布比较。",
			"upd.current": "当前版本",
			"upd.latest": "最新版本",
			"upd.kind": "安装方式",
			"upd.kindSource": "源码构建（git clone）",
			"upd.kindPackaged": "发行包安装（npm/pnpm）",
			"upd.kindUnknown": "未知",
			"upd.dir": "源码目录",
			"upd.uptodate": "已是最新版本",
			"upd.available": "有新版本可用",
			"upd.unknown": "暂时无法比较",
			"upd.checking": "正在检查…",
			"upd.refresh": "重新检查",
			"upd.releases": "打开 Releases 页面",
			"upd.published": "发布于",
			"upd.prerelease": "预发布",
			"upd.stale": "缓存数据（可能过期）",
			"upd.latestFailed": "获取最新版本失败",
			"upd.cmdTitle": "更新命令",
			"upd.npmTitle": "npm 包安装 / 更新（推荐）",
			"upd.srcTitle": "源码构建更新",
			"upd.note": "@latest 表示取 npm 上的最新发布版，换成 @<具体版本号> 即可固定版本；pnpm 用户等价命令为 pnpm add -g 与 pnpm dlx。第二组命令适用于源码构建安装：命令里的目录是占位符，请先 cd 进本机已克隆的仓库目录（即上方\"源码目录\"）再执行，git pull 就地更新现有 checkout，不要把仓库重新 clone 进别的目录。",
			"upd.copy": "复制全部",
			"upd.copied": "已复制到剪贴板 ✓",
			"upd.copyFailed": "复制失败，请手动选中代码复制",
			"upd.termTitle": "快速开始",
			"upd.termDesc": "在识别到的源码目录打开一个命令行窗口，由你自己粘贴执行上面的命令。",
			"upd.openTerm": "在源码目录打开 CMD",
			"upd.termOpened": "已打开命令行窗口：",
			"upd.termFailed": "打开失败",
			"upd.noDir": "未识别到源码目录（可设置环境变量 DSH_BETTER_REPO_ROOT 后重启后端）",
			"upd.network": "网络错误",
			"mr.entry": "模型路由",
			"mr.entryDesc": "关键词规则切换会话模型与白名单切换工具",
			"mr.title": "模型路由",
			"mr.intro": "按关键词把会话路由到指定模型；也可开放一个受白名单限制的手动切换工具。模型提供方仍请在 DSH 模型页配置。",
			"mr.unavailable": "模型路由引擎不可用",
			"mr.loading": "正在读取配置…",
			"mr.network": "网络错误",
			"mr.loadFailed": "读取失败",
			"mr.statusEngine": "路由引擎",
			"mr.on": "已启用",
			"mr.off": "已停用",
			"mr.rulesCount": "规则",
			"mr.allowCount": "白名单条目",
			"mr.effective": "当前会话选择",
			"mr.noSession": "无活动会话",
			"mr.sourceSession": "来源：会话头",
			"mr.sourceDefault": "来源：宿主默认",
			"mr.defaultModel": "宿主默认模型（只读）",
			"mr.featureTool": "model_route 工具",
			"mr.registered": "已注册",
			"mr.unregistered": "未注册",
			"mr.masterEnable": "启用路由引擎",
			"mr.masterDesc": "停用后不监听消息、不注册工具、不改写任何会话模型",
			"mr.matchCase": "关键词大小写敏感",
			"mr.rules": "路由规则",
			"mr.rulesHint": "按顺序匹配、命中即停；未命中不改动会话模型。未激活目标可保存，但执行前校验不会通过。",
			"mr.addRule": "新增规则",
			"mr.ruleKeywords": "关键词",
			"mr.ruleKeywordsHint": "逗号分隔，任一命中即选中该规则",
			"mr.targetProvider": "目标提供方",
			"mr.targetModel": "目标模型",
			"mr.targetEffort": "推理强度",
			"mr.effortHint": "留空＝适配器默认",
			"mr.activeGroup": "已激活",
			"mr.dormantGroup": "未激活",
			"mr.applySession": "应用到本会话",
			"mr.remove": "删除",
			"mr.catalogError": "该提供方目录读取失败；已保存的规则不受影响",
			"mr.activeBadge": "已生效",
			"mr.validated": "目标校验通过，命中时生效",
			"mr.inactiveBadge": "未生效",
			"mr.invalidHint": "目标未通过实时校验（提供方未激活 / 模型或推理强度无效），暂不会路由",
			"mr.allowTitle": "model_route 切换工具",
			"mr.allowDesc": "开启后，智能体只能在白名单范围内切换当前会话的模型；每次执行仍经实时精确校验。",
			"mr.allowToggle": "启用工具",
			"mr.allowEntries": "白名单",
			"mr.addAllow": "新增允许路由",
			"mr.allowEmpty": "白名单为空——开启工具但无条目时不会注册任何可切换路由。",
			"mr.save": "保存",
			"mr.saving": "保存中…",
			"mr.discard": "放弃更改",
			"mr.saved": "设置已保存并实时生效。",
			"mr.conflict": "配置已被其他窗口修改，请刷新后重试。",
			"mr.invalid": "配置校验失败",
			"mr.appliedOk": "已应用到当前会话。",
			"mr.dirty": "有未保存的修改",
			"mr.subagentRepair": "子代理修复",
			"mr.cardTitle": "模型路由",
			"mr.cardRunning": "切换模型中…",
			"mr.cardNext": "下一条助手消息将使用此路由",
			"mr.cardDone": "路由已应用",
			"mr.cardFailed": "切换失败",
			"sn.nav": "侧边滚动栏",
			"sn.entry": "侧边滚动栏",
			"sn.entryDesc": "聊天区右侧的用户消息刻度线，悬浮预览、点击跳转",
			"sn.title": "侧边滚动栏",
			"sn.intro": "1:1 复刻 chat.deepseek.com 的滚动导航：每条你发出的消息对应一根刻度线；鼠标移上去弹出预览小窗，窗内一条消息对一根刻度，消息多时可滚轮翻阅，点击直达；正在浏览的那条会以品牌色高亮。默认自动适配浅色/深色主题。",
			"sn.enable": "启用侧边滚动栏",
			"sn.enableDesc": "仅当会话内容超出一屏且至少有两条用户消息时出现",
			"sn.colors": "自定义配色",
			"sn.customColorsDesc": "关闭时自动跟随应用的浅色/深色主题",
			"sn.trackColor": "轨道颜色",
			"sn.trackOpacity": "轨道不透明度",
			"sn.panelColor": "预览小窗背景",
			"sn.tickColor": "刻度颜色",
			"sn.tickOpacity": "刻度不透明度",
			"sn.hoverColor": "悬浮行高亮色",
			"sn.activeColor": "当前消息品牌色",
			"sn.labelColor": "预览文字颜色",
			"sn.imageFallback": "[图片]",
			"sn.emptyPreview": "（空消息）",
			"sn.railLabel": "用户消息导航"
		};
		const en = {
			"nav": "Better DSH",
			"back": "Back",
			"root.title": "Better DSH",
			"root.intro": "Enhancements provided by the dsh-better plugin.",
			"arch.entry": "Archived sessions",
			"arch.entryDesc": "View, restore, or delete archived conversations",
			"ntf.entry": "Task notifications",
			"ntf.entryDesc": "Windows toast when a task stops",
			"arch.title": "Archived sessions",
			"arch.intro": "These conversations are hidden from the sidebar. Restore returns one to its workspace slot; delete removes its local log as well.",
			"arch.loading": "Loading archive…",
			"arch.empty": "No archived conversations",
			"arch.restore": "Restore",
			"arch.delete": "Delete",
			"arch.deleteTitle": "Delete this archived conversation?",
			"arch.deleteBody": "Its local log file will be removed. This cannot be undone.",
			"arch.confirmDelete": "Delete",
			"arch.cancel": "Cancel",
			"arch.restored": "Restored — it will reappear in its workspace shortly",
			"arch.deleted": "Local archive deleted",
			"arch.failed": "Operation failed",
			"arch.noArtifact": "no standalone artifact",
		"arch.orphan": "local archive no longer exists (stale entry)",
		"arch.more": "More actions",
			"ntf.title": "Task notifications",
			"ntf.intro": "While this page stays open in the browser, stopped tasks raise native Windows toasts (bottom-right).",
			"ntf.enable": "Enable task notifications",
			"ntf.enableDesc": "Closing the page stops the notifications too",
			"ntf.permission": "Notification permission",
			"ntf.permDefault": "not granted yet",
			"ntf.permGranted": "granted",
			"ntf.permDenied": "denied — re-enable it in the browser's site permission settings",
			"ntf.permUnsupported": "this environment does not support notifications",
			"ntf.request": "Request permission",
			"ntf.events": "Notify on",
			"ntf.evOptions": "Agent asks with options",
			"ntf.evDone": "Task finishes",
			"ntf.evError": "Task stops with an error",
			"ntf.test": "Send a test notification",
			"ntf.testSent": "Test notification sent",
			"n.title.options": "Options",
			"n.title.done": "Completed",
			"n.title.error": "Error",
			"n.body.stopped": "Stopped",
			"n.body.ended": "Ended",
			"n.body.unnamed": "Untitled task",
			"upd.entry": "Check for updates",
			"upd.entryDesc": "Compare the installed version with the latest GitHub release",
			"upd.title": "Check for updates",
			"upd.intro": "Reads the local dsh installation facts and compares them with the latest GitHub release.",
			"upd.current": "Installed version",
			"upd.latest": "Latest release",
			"upd.kind": "Install kind",
			"upd.kindSource": "Source build (git clone)",
			"upd.kindPackaged": "Packaged install (npm/pnpm)",
			"upd.kindUnknown": "Unknown",
			"upd.dir": "Checkout directory",
			"upd.uptodate": "Up to date",
			"upd.available": "Update available",
			"upd.unknown": "Cannot compare right now",
			"upd.checking": "Checking…",
			"upd.refresh": "Re-check",
			"upd.releases": "Open the releases page",
			"upd.published": "Published",
			"upd.prerelease": "pre-release",
			"upd.stale": "Cached data (may be outdated)",
			"upd.latestFailed": "Failed to fetch the latest release",
			"upd.cmdTitle": "Update commands",
			"upd.npmTitle": "npm package install / update (recommended)",
			"upd.srcTitle": "Source-build update",
			"upd.note": "@latest resolves to the newest npm release; swap it for @<version> to pin one. pnpm equivalents: pnpm add -g / pnpm dlx. The second group updates an existing source checkout in place: the directory is a placeholder — cd into your already-cloned repository (the checkout directory shown above) first, then run git pull there; do not clone the repository into a different directory.",
			"upd.copy": "Copy all",
			"upd.copied": "Copied to clipboard ✓",
			"upd.copyFailed": "Copy failed — please select and copy manually",
			"upd.termTitle": "Quick start",
			"upd.termDesc": "Opens a console window in the discovered checkout directory so you can paste and run the commands yourself.",
			"upd.openTerm": "Open CMD at the checkout",
			"upd.termOpened": "Console window opened at:",
			"upd.termFailed": "Failed to open",
			"upd.noDir": "No checkout directory found (set DSH_BETTER_REPO_ROOT and restart the backend)",
			"upd.network": "network error",
			"mr.entry": "Model routing",
			"mr.entryDesc": "Keyword rules for session models and an allowlist-gated switch tool",
			"mr.title": "Model routing",
			"mr.intro": "Route sessions to a target model by keywords, and optionally expose an allowlist-gated manual switch tool. Model providers stay on the DSH Models page.",
			"mr.unavailable": "The model routing engine is unavailable",
			"mr.loading": "Loading configuration…",
			"mr.network": "network error",
			"mr.loadFailed": "Failed to load",
			"mr.statusEngine": "Routing engine",
			"mr.on": "On",
			"mr.off": "Off",
			"mr.rulesCount": "Rules",
			"mr.allowCount": "Allowlist entries",
			"mr.effective": "Current session selection",
			"mr.noSession": "No active session",
			"mr.sourceSession": "from session header",
			"mr.sourceDefault": "from harness default",
			"mr.defaultModel": "Harness default model (read-only)",
			"mr.featureTool": "model_route tool",
			"mr.registered": "registered",
			"mr.unregistered": "not registered",
			"mr.masterEnable": "Enable the routing engine",
			"mr.masterDesc": "When off: no message listening, no tools, no session writes",
			"mr.matchCase": "Case-sensitive keyword matching",
			"mr.rules": "Routing rules",
			"mr.rulesHint": "Ordered, first match wins; a miss changes nothing. Dormant targets can be saved but never execute.",
			"mr.addRule": "Add rule",
			"mr.ruleKeywords": "Keywords",
			"mr.ruleKeywordsHint": "Comma-separated; any hit selects this rule",
			"mr.targetProvider": "Target provider",
			"mr.targetModel": "Target model",
			"mr.targetEffort": "Reasoning effort",
			"mr.effortHint": "Empty = adapter default",
			"mr.activeGroup": "Active",
			"mr.dormantGroup": "Dormant",
			"mr.applySession": "Apply to this session",
			"mr.remove": "Remove",
			"mr.catalogError": "Catalog failed for this provider; saved rules are kept",
			"mr.activeBadge": "Active",
			"mr.validated": "Target validated; fires on a match",
			"mr.inactiveBadge": "Inactive",
			"mr.invalidHint": "Target did not pass live validation (provider dormant / invalid model or effort); it will not route yet",
			"mr.allowTitle": "model_route switch tool",
			"mr.allowDesc": "When enabled, the agent may switch the session model ONLY within the allowlist; every execution is still validated live.",
			"mr.allowToggle": "Enable the tool",
			"mr.allowEntries": "Allowlist",
			"mr.addAllow": "Add allowed route",
			"mr.allowEmpty": "Allowlist is empty — an enabled switch with no entries registers no tool.",
			"mr.save": "Save",
			"mr.saving": "Saving…",
			"mr.discard": "Discard changes",
			"mr.saved": "Settings saved and applied live.",
			"mr.conflict": "The configuration changed elsewhere — reload and try again.",
			"mr.invalid": "Configuration validation failed",
			"mr.appliedOk": "Applied to the current session.",
			"mr.dirty": "Unsaved changes",
			"mr.subagentRepair": "Subagent repair",
			"mr.cardTitle": "Model route",
			"mr.cardRunning": "Switching model…",
			"mr.cardNext": "The next assistant message runs on this route",
			"mr.cardDone": "Route applied",
			"mr.cardFailed": "Switch failed",
			"sn.nav": "Message scroll nav",
			"sn.entry": "Message scroll nav",
			"sn.entryDesc": "Tick marks for your messages at the conversation edge — hover to preview, click to jump",
			"sn.title": "Message scroll nav",
			"sn.intro": "A 1:1 port of the chat.deepseek.com scroll nav: each message you sent maps to one tick line; hovering pops up a preview panel where one row pairs with one tick, the wheel scrolls when it overflows, and clicking jumps straight there. The message currently in view carries the brand-colored active tick. Follows the light/dark theme by default.",
			"sn.enable": "Enable the message scroll nav",
			"sn.enableDesc": "Appears only when the conversation overflows and holds at least two user messages",
			"sn.colors": "Custom colors",
			"sn.customColorsDesc": "Off = follow the app's light/dark theme automatically",
			"sn.trackColor": "Track color",
			"sn.trackOpacity": "Track opacity",
			"sn.panelColor": "Panel background",
			"sn.tickColor": "Tick color",
			"sn.tickOpacity": "Tick opacity",
			"sn.hoverColor": "Hovered-row highlight",
			"sn.activeColor": "Active-message brand color",
			"sn.labelColor": "Preview text color",
			"sn.imageFallback": "[image]",
			"sn.emptyPreview": "(empty message)",
			"sn.railLabel": "User message navigation"
		};
		//#endregion

		//#region small react helpers
		const h = React.createElement;
		function useSnapshot(subscribe, get) {
			const [value, setValue] = React.useState(() => {
				try { return get(); } catch { return undefined; }
			});
			React.useEffect(() => {
				let alive = true;
				let off;
				try {
					const sync = () => { if (alive) { try { setValue(get()); } catch {} } };
					off = subscribe(sync);
					sync();
				} catch { /* degraded: keep the initial snapshot */ }
				return () => { alive = false; try { off?.(); } catch {} };
			}, []);
			return value;
		}
		//#endregion

		//#region host endpoint client (same-origin fetch against the exact routes)
		async function callHost(path, body) {
			const response = await fetch(path, {
				method: body === undefined ? "GET" : "POST",
				headers: body === undefined ? undefined : { "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			let payload;
			try { payload = await response.json(); } catch { payload = { ok: false, error: "bad-response" }; }
			return { status: response.status, payload };
		}
		//#endregion

		//#region notification engine
		/**
		 * Observe the session runtime's two frame entry points by wrapping their
		 * prototype methods (or own properties). Every wrapper calls through and
		 * swallows only ITS OWN observer errors; dispatch itself is untouched.
		 */
		function createNotificationEngine(ctx, t, settingsFace) {
			const askingSessions = new Set();
			const recentErrors = new Map();
			const lastEndReason = new Map();
			const prevRunning = new Map();
			const lastNotifiedAt = new Map();
			let disposed = false;

			const ERROR_SUPPRESS_MS = 8000;
			const NOTIFY_MIN_INTERVAL_MS = 1500;

			function settings() { return settingsFace.get(); }

			function sessionTitle(sessionId) {
				try {
					const row = ctx.sessions.list.getSnapshot().byId[sessionId];
					if (row !== undefined && row.displayTitle !== "" && row.displayTitle !== sessionId) return row.displayTitle;
					if (row?.title) return row.title;
				} catch { /* title lookup is best-effort */ }
				return t("n.body.unnamed");
			}

			function shouldNotifyNow(kind, sessionId) {
				const key = kind + ":" + sessionId;
				const now = Date.now();
				const last = lastNotifiedAt.get(key) ?? 0;
				if (now - last < NOTIFY_MIN_INTERVAL_MS) return false;
				lastNotifiedAt.set(key, now);
				return true;
			}

			async function show(kind, sessionId, titleText, bodyText) {
				if (disposed || typeof Notification === "undefined" || Notification.permission !== "granted") return;
				if (!shouldNotifyNow(kind, sessionId)) return;
				const icon = await whaleIconDataUrl();
				try {
					const toast = new Notification(titleText, { body: bodyText, tag: "dsh-better:" + kind + ":" + sessionId, ...(icon === undefined ? {} : { icon }) });
					toast.onclick = () => { try { window.focus(); } catch {} };
				} catch { // Some engines reject constructor options; retry bare.
					try { new Notification(titleText, { body: bodyText }); } catch {}
				}
			}

			function notifyOptions(sessionId, questions) {
				if (!settings().enabled || !settings().options) return;
				const lines = [];
				let index = 0;
				for (const question of questions ?? []) {
					if (question.question) lines.push(question.question);
					for (const option of question.options ?? []) {
						index += 1;
						lines.push(index + "\u3001" + String(option.label ?? "").replace(/\s*\((?:recommended|推荐)\)\s*$/i, ""));
					}
				}
				if (lines.length === 0) lines.push(sessionId);
				void show("options", sessionId, t("n.title.options"), lines.join("\n").slice(0, 450));
			}

			function doneBodyFor(reason) {
				if (reason === "aborted" || reason === "cancelled") return t("n.body.stopped");
				if (reason === "completed") return t("n.title.done");
				return t("n.body.ended");
			}

			function notifyDone(sessionId) {
				if (!settings().enabled || !settings().done) return;
				const reason = lastEndReason.get(sessionId);
				void show("done", sessionId, sessionTitle(sessionId), doneBodyFor(reason));
			}

			function notifyError(sessionId, message) {
				if (!settings().enabled || !settings().error) return;
				recentErrors.set(sessionId, Date.now());
				void show("error", sessionId, t("n.title.error"), String(message ?? "").slice(0, 450));
			}

			function isBackgroundOnly(row) {
				// Subagent child sessions complete inside the parent's turn; notifying
				// per child duplicates what the parent's completion already reports.
				return row?.origin === "subagent" || row?.parentId !== undefined;
			}

			function onMuxFrame(frame) {
				if (frame === null || typeof frame !== "object") return;
				if (frame.type === "question/requested") {
					askingSessions.add(String(frame.sessionId));
					notifyOptions(frame.sessionId, frame.questions);
					return;
				}
				if (frame.type === "question/resolved") {
					askingSessions.delete(String(frame.sessionId));
					return;
				}
				if (frame.type === "session/event" && frame.event?.type === "turn/end") {
					const reason = frame.event.data && typeof frame.event.data === "object"
						? (frame.event.data.reason?.kind ?? frame.event.data.reason)
						: undefined;
					lastEndReason.set(String(frame.sessionId), typeof reason === "string" ? reason : undefined);
				}
			}

			function onHostFrame(frame) {
				if (frame === null || typeof frame !== "object") return;
				if (frame.type === "host/agent-error") {
					notifyError(frame.sessionId, frame.message);
					return;
				}
				if (frame.type === "host/session-status") {
					const sid = String(frame.sessionId);
					const previous = prevRunning.get(sid);
					prevRunning.set(sid, frame.running === true);
					if (frame.running === false && previous === true && !askingSessions.has(sid)) {
						const erroredAt = recentErrors.get(sid);
						if (erroredAt !== undefined && Date.now() - erroredAt < ERROR_SUPPRESS_MS) {
							recentErrors.delete(sid);
							return;
						}
						let row;
						try { row = ctx.sessions.list.getSnapshot().byId[sid]; } catch {}
						if (isBackgroundOnly(row)) return;
						notifyDone(sid);
					}
					if (frame.running === true) {
						// A fresh run clears any stale "still asking" state left behind by
						// a session that died mid-question (its resolved frame never came).
						askingSessions.delete(sid);
						recentErrors.delete(sid);
						lastEndReason.delete(sid);
					}
				}
			}

			const WRAP_MARK = "__dshBetterOriginal";
			const unwraps = [];

			function wrap(owner, key, observer) {
				let original = owner?.[key];
				if (typeof original !== "function") return;
				// A previous engine's un-disposed wrapper may still sit here; peel it
				// off instead of stacking yet another layer over it.
				if (typeof original[WRAP_MARK] === "function") original = original[WRAP_MARK];
				const wrapped = function (...args) {
					try { observer(args[0]?.payload); } catch { /* observer must not affect dispatch */ }
					return original.apply(this, args);
				};
				wrapped[WRAP_MARK] = original;
				owner[key] = wrapped;
				unwraps.push(() => { if (owner[key] === wrapped) owner[key] = original; });
			}

			function install() {
				const proto = Object.getPrototypeOf(ctx.sessions);
				if (proto === undefined) return;
				// Seed the running bits so a tab opened mid-turn still observes the
				// true->false edge instead of swallowing it as a first sighting.
				try {
					for (const row of Object.values(ctx.sessions.list.getSnapshot().byId)) {
						prevRunning.set(String(row.id), row.running === true);
					}
				} catch { /* seeding is best-effort */ }
				wrap(proto, "handleMuxEnvelope", onMuxFrame);
				wrap(proto, "handleHostEnvelope", onHostFrame);
			}

			function dispose() {
				disposed = true;
				for (const undo of unwraps.splice(0)) { try { undo(); } catch { /* page is going away anyway */ } }
				askingSessions.clear();
				prevRunning.clear();
				recentErrors.clear();
				lastEndReason.clear();
				lastNotifiedAt.clear();
			}

			return { install, dispose, notifyErrorNow: (message) => void show("test", "test", "dsh-better", message) };
		}
		//#region scroll nav rail (chat.deepseek.com-style message ticks)
		/** Collapse one ContentBlock[] into a single preview line. */
		function snPreviewFromContent(content, imageFallback) {
			let text = "";
			let hasImage = false;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
						text += (text === "" ? "" : " ") + block.text;
					} else if (block !== null && typeof block === "object" && block.type === "image") {
						hasImage = true;
					}
				}
			}
			text = text.replace(/\s+/g, " ").trim();
			if (text !== "") return text.length > 120 ? text.slice(0, 120) + "…" : text;
			return hasImage ? imageFallback : "";
		}

		/**
		 * User-authored ticks from a ConversationSnapshot: chat nodes of kind
		 * `user` or `steering`, keyed by their stable anchor key so each tick
		 * maps onto the row rendered with the same data-chat-anchor-key.
		 */
		function snDeriveTicks(conversation, t) {
			if (!conversation) return [];
			const chat = conversation.chat;
			const order = chat !== undefined && Array.isArray(chat.order) ? chat.order : null;
			const store = chat !== undefined && chat.nodes !== undefined && typeof chat.nodes.get === "function" ? chat.nodes : null;
			if (order === null || store === null) return [];
			const ticks = [];
			for (const key of order) {
				let node;
				try { node = store.get(key); } catch { node = undefined; }
				if (node === undefined || node === null || node.visibility === "hidden") continue;
				if (node.kind !== "user" && node.kind !== "steering") continue;
				const data = node.data ?? {};
				ticks.push({
					key: String(node.key ?? key),
					text: snPreviewFromContent(data.content, t("sn.imageFallback")),
				});
			}
			return ticks;
		}

		/**
		 * Heartbeat timer of the LATEST jump only — a newer click cancels the
		 * previous guard, or stale beats would drag the viewport back to an old
		 * target after rapid tick-switching. snCancelJump also detaches the
		 * jump's user-input abort listeners; LiveRail's unmount cleanup calls it
		 * so a pending guard can never outlive its own conversation view.
		 */
		let snJumpTimer = 0;
		let snJumpAbort = null;
		function snCancelJump() {
			const abort = snJumpAbort;
			snJumpAbort = null;
			if (abort !== null) { try { abort(); } catch { /* already detached */ } }
			if (snJumpTimer !== 0) { clearTimeout(snJumpTimer); snJumpTimer = 0; }
		}

		/**
		 * Scroll the conversation scrollport so one anchor row lands near its
		 * top. While the view is pinned to the bottom of a RUNNING session,
		 * ChatView's bottom-follow re-asserts the floor on every streamed resize
		 * and its resize callback can even outrun the scroll handler our first
		 * write arms — so the jump re-asserts itself for up to ~5s until the
		 * position sticks (each off-bottom write flips the view's own
		 * at-bottom detection, which disengages the follower).
		 */
		function snJumpToAnchor(key) {
			try {
				if (typeof document.querySelector !== "function") return;
				const port = document.querySelector("[data-conversation-scroll]");
				if (port === null) return;
				let row = null;
				for (const candidate of port.querySelectorAll("[data-chat-anchor-key]")) {
					if (candidate.getAttribute("data-chat-anchor-key") === key) { row = candidate; break; }
				}
				if (row === null) return;
				const offset = row.getBoundingClientRect().top - port.getBoundingClientRect().top;
				const top = Math.max(0, port.scrollTop + offset - 16);
				// Smooth glide with a heartbeat guard: while the view is pinned to
				// the bottom of a RUNNING session, ChatView's bottom-follow may
				// re-assert the floor and win the race against the animation. The
				// heartbeat re-issues the glide when the position stopped moving
				// short of the target; after three consecutive drags-back it
				// finishes with one instant step so a heavily streaming turn cannot
				// keep the jump dead forever. An in-flight glide is never
				// interrupted — but real user input (wheel / touch) cancels the
				// guard outright, so it never fights the hand that feeds it.
				let lastSeen = -1;
				let beats = 0;
				let drags = 0;
				const onUserScroll = () => { stop(); };
				const stop = () => {
					snJumpAbort = null;
					if (snJumpTimer !== 0) { clearTimeout(snJumpTimer); snJumpTimer = 0; }
					port.removeEventListener("wheel", onUserScroll, { passive: true });
					port.removeEventListener("touchstart", onUserScroll, { passive: true });
				};
				const beat = () => {
					try {
						if (!port.isConnected) { stop(); return; }
						const now = port.scrollTop;
						const moving = Math.abs(now - lastSeen) > 2;
						lastSeen = now;
						if (Math.abs(now - top) <= 24) { stop(); return; }
						if (!moving) {
							drags += 1;
							port.scrollTo({ top, behavior: drags >= 3 ? "auto" : "smooth" });
						}
						beats += 1;
						if (beats < 40) { snJumpTimer = setTimeout(beat, 130); } else { stop(); }
					} catch { stop(); }
				};
				snCancelJump();
				port.addEventListener("wheel", onUserScroll, { passive: true });
				port.addEventListener("touchstart", onUserScroll, { passive: true });
				snJumpAbort = stop;
				port.scrollTo({ top, behavior: "smooth" });
				snJumpTimer = setTimeout(beat, 160);
			} catch { /* best-effort navigation */ }
		}

		/**
		 * Frame-level entry: reads the enabled flag and current session id, then
		 * mounts one live rail per session (keyed remount keeps useSnapshot's
		 * single-mount subscription aligned with the binding's lifetime).
		 */
		function ScrollNavRail(props) {
			const { ctx, t, useSessions } = props;
			const settings = useSnapshot(subscribeScrollNavSettings, () => scrollNavSettings);
			const currentId = typeof useSessions === "function"
				? useSessions((s) => s.current)
				: undefined;
			if (!settings.enabled || currentId === undefined || currentId === null) return null;
			return h(ScrollNavLiveRail, { key: String(currentId), ctx, t, sessionId: currentId });
		}

		function ScrollNavLiveRail({ ctx, t, sessionId }) {
			// Hook order contract: every hook runs unconditionally on every render.
			const [open, setOpen] = React.useState(false);
			const [activeKey, setActiveKey] = React.useState(undefined);
			const [fades, setFades] = React.useState({ canScroll: false, atTop: true, atBottom: true });
			const [portScrollable, setPortScrollable] = React.useState(false);
			const listRef = React.useRef(null);
			const [binding] = React.useState(() => {
				try { return ctx.sessions.binding(sessionId); } catch { return undefined; }
			});
			const conversation = useSnapshot(
				binding?.session ? (cb) => binding.session.subscribe(cb) : () => () => {},
				binding?.session ? () => binding.session.getSnapshot() : () => undefined,
			);
			const ticks = React.useMemo(() => snDeriveTicks(conversation, t), [conversation, t]);
			// The watcher below lives for the whole rail lifetime; streaming
			// snapshots reach it through ticksRef (fresh data) plus the post-render
			// nudge (fresh verdicts) instead of tearing its listeners down and
			// reinstalling them on every batch.
			const ticksRef = React.useRef(ticks);
			const nudgeRef = React.useRef(null);
			// Functional-update bail-out: equal fades reuse prev so a state write
			// can never re-trigger the very render that would compute it again.
			const applyFades = React.useCallback((canScroll, atTop, atBottom) => {
				setFades((prev) => (prev.canScroll === canScroll && prev.atTop === atTop && prev.atBottom === atBottom ? prev : { canScroll, atTop, atBottom }));
			}, []);
			// One long-lived watcher maintains every DOM-derived bit for the whole
			// lifetime of this rail: whether the conversation overflows enough to
			// justify the rail at all; the active (currently-read) tick computed
			// synchronously on each scroll — rAF would freeze for backgrounded
			// windows and leave the marker stale; and the two gradient fades shown
			// only where the panel list can still scroll. Listeners bind ONCE —
			// under the old deps-[ticks] re-arm, a scroll event landing between
			// teardown and reinstall was silently dropped on streaming batches.
			// The conversation scrollport is re-acquired lazily (nudge / scroll /
			// resize all retry), so a port that mounts late or is replaced
			// mid-session re-binds itself instead of hiding the rail forever.
			React.useEffect(() => {
				if (typeof document.querySelector !== "function") return undefined;
				const SEL = "[data-conversation-scroll]";
				let port = null;
				let ro = null;
				const computeFades = () => {
					const list = listRef.current;
					if (list === null) return;
					applyFades(
						list.scrollHeight > list.clientHeight + 4,
						list.scrollTop <= 4,
						list.scrollTop >= list.scrollHeight - list.clientHeight - 4,
					);
				};
				const computeActive = () => {
					try {
						if (port === null || !port.isConnected) return;
						const keys = new Set(ticksRef.current.map((tick) => tick.key));
						const limit = port.getBoundingClientRect().top + 96;
						let current;
						for (const row of port.querySelectorAll("[data-chat-anchor-key]")) {
							const key = row.getAttribute("data-chat-anchor-key");
							if (!keys.has(key)) continue;
							if (row.getBoundingClientRect().top <= limit) current = key;
							else break;
						}
						if (current === undefined) {
							for (const row of port.querySelectorAll("[data-chat-anchor-key]")) {
								const key = row.getAttribute("data-chat-anchor-key");
								if (keys.has(key)) { current = key; break; }
							}
						}
						setActiveKey((prev) => (prev === current ? prev : current));
					} catch { /* keep last state */ }
				};
				const updateOverflow = () => {
					if (port !== null) {
						try { setPortScrollable(port.scrollHeight - port.clientHeight > 80); } catch { /* keep last state */ }
					}
				};
				const computeAll = () => { updateOverflow(); computeFades(); computeActive(); };
				const rebindRo = () => {
					if (ro === null && typeof ResizeObserver === "function") ro = new ResizeObserver(computeAll);
					if (ro !== null) { ro.disconnect(); if (port !== null && port.isConnected) ro.observe(port); }
				};
				const refreshPort = () => {
					if (port !== null && !port.isConnected) port = null;
					if (port === null) {
						let found = null;
						try { found = document.querySelector(SEL); } catch { found = null; }
						if (found !== null) { port = found; rebindRo(); }
					}
				};
				nudgeRef.current = computeAll;
				computeAll();
				// Capture-phase delegation: scrolls from ANY element reach us, so a
				// swapped-in scrollport retargets itself on its very first scroll.
				const onScroll = (event) => {
					const target = event.target;
					if (target !== null && typeof target.matches === "function" && target.matches(SEL)) {
						if (target !== port) { port = target; rebindRo(); }
						computeAll();
					}
				};
				document.addEventListener("scroll", onScroll, { capture: true, passive: true });
				window.addEventListener("resize", computeAll);
				return () => {
					nudgeRef.current = null;
					document.removeEventListener("scroll", onScroll, { capture: true });
					window.removeEventListener("resize", computeAll);
					if (ro !== null) { ro.disconnect(); ro = null; }
				};
			}, []);
			// Post-render nudge: replays the DOM-derived verdicts (never the
			// subscriptions) so snapshot-driven layout shifts behave exactly like
			// the previous re-arm-per-snapshot design did.
			React.useEffect(() => {
				ticksRef.current = ticks;
				nudgeRef.current?.();
			});
			// A pending jump guard must never outlive its own conversation view:
			// switching sessions remounts this keyed component, and cleanup here
			// cancels the heartbeat aimed at the OLD session's scrollTop.
			React.useEffect(() => () => { snCancelJump(); }, []);
			if (binding === undefined || conversation === undefined) return null;
			if (ticks.length < 2 || !portScrollable) return null;
			return h("div", { className: "dtb_sn", style: scrollNavCssVars(scrollNavSettings), role: "navigation", "aria-label": t("sn.railLabel"),
				"data-open": open ? "1" : "0",
				onMouseEnter: () => setOpen(true),
				onMouseLeave: () => setOpen(false) },
				h("div", { className: "dtb_sn_track" }),
				h("div", { className: "dtb_sn_panel" },
					h("div", { className: "dtb_sn_fade dtb_sn_fadeTop", "data-show": fades.canScroll && !fades.atTop ? "1" : "0" }),
					h("div", { className: "dtb_sn_list", ref: listRef,
						onScroll: () => {
							const list = listRef.current;
							if (list === null) return;
							applyFades(
								list.scrollHeight > list.clientHeight + 4,
								list.scrollTop <= 4,
								list.scrollTop >= list.scrollHeight - list.clientHeight - 4,
							);
						} },
						ticks.map((tick) => h("div", {
							key: tick.key,
							className: "dtb_sn_row",
							role: "button",
							title: tick.text,
							"data-active": activeKey === tick.key ? "1" : "0",
							onClick: () => snJumpToAnchor(tick.key),
						},
						h("span", { className: "dtb_sn_label" }, tick.text === "" ? t("sn.emptyPreview") : tick.text),
						h("span", { className: "dtb_sn_tickHolder" }, h("span", { className: "dtb_sn_tick" }))))),
					h("div", { className: "dtb_sn_fade dtb_sn_fadeBottom", "data-show": fades.canScroll && !fades.atBottom ? "1" : "0" })));
		}

		//#region scroll nav settings page
		function SnColorRow({ label, value, onChange }) {
			return h("div", { className: "dtb_sn_colorRow" },
				h("span", null, label),
				h("input", { type: "color", className: "dtb_sn_color", value, onChange: (e) => onChange(e.target.value) }),
				h("code", { className: "dtb_sn_hex" }, value));
		}
		function SnAlphaRow({ label, value, onChange }) {
			return h("div", { className: "dtb_sn_colorRow" },
				h("span", null, label),
				h("input", { type: "range", className: "dtb_sn_range", min: 0.05, max: 1, step: 0.05, value: String(value), onChange: (e) => onChange(Number(e.target.value)) }),
				h("code", { className: "dtb_sn_hex" }, Math.round(value * 100) + "%"));
		}
		function ScrollNavPage({ t, onBack }) {
			const settings = useSnapshot(subscribeScrollNavSettings, () => scrollNavSettings);
			return h("div", { className: "dtb_page" },
				h(BackBar, { t, onBack }),
				h("div", { className: "dtb_title" }, t("sn.title")),
				h("p", { className: "dtb_intro" }, t("sn.intro")),
				h("div", { className: "dtb_card" },
					h("div", { className: "dtb_switchRow" },
						h("div", { className: "dtb_switchText" },
							h("span", { className: "dtb_switchLabel" }, t("sn.enable")),
							h("span", { className: "dtb_switchDesc" }, t("sn.enableDesc"))),
						h(Toggle, { on: settings.enabled, onToggle: () => updateScrollNavSettings({ enabled: !settings.enabled }) }))),
				h("div", { className: "dtb_card" },
					h("div", { className: "dtb_switchRow" },
						h("div", { className: "dtb_switchText" },
							h("span", { className: "dtb_switchLabel" }, t("sn.colors")),
							h("span", { className: "dtb_switchDesc" }, t("sn.customColorsDesc"))),
						h(Toggle, { on: settings.customColors, onToggle: () => updateScrollNavSettings({ customColors: !settings.customColors }) })),
					settings.customColors && h(SnColorRow, { label: t("sn.trackColor"), value: settings.trackColor, onChange: (v) => updateScrollNavSettings({ trackColor: v }) }),
					settings.customColors && h(SnAlphaRow, { label: t("sn.trackOpacity"), value: settings.trackOpacity, onChange: (v) => updateScrollNavSettings({ trackOpacity: v }) }),
					settings.customColors && h(SnColorRow, { label: t("sn.panelColor"), value: settings.panelColor, onChange: (v) => updateScrollNavSettings({ panelColor: v }) }),
					settings.customColors && h(SnColorRow, { label: t("sn.tickColor"), value: settings.tickColor, onChange: (v) => updateScrollNavSettings({ tickColor: v }) }),
					settings.customColors && h(SnAlphaRow, { label: t("sn.tickOpacity"), value: settings.tickOpacity, onChange: (v) => updateScrollNavSettings({ tickOpacity: v }) }),
					settings.customColors && h(SnColorRow, { label: t("sn.hoverColor"), value: settings.hoverColor, onChange: (v) => updateScrollNavSettings({ hoverColor: v }) }),
					settings.customColors && h(SnColorRow, { label: t("sn.activeColor"), value: settings.activeColor, onChange: (v) => updateScrollNavSettings({ activeColor: v }) }),
					settings.customColors && h(SnColorRow, { label: t("sn.labelColor"), value: settings.labelColor, onChange: (v) => updateScrollNavSettings({ labelColor: v }) })),
			);
		}
		//#endregion
		//#endregion

		//#region ui atoms
		function Toggle(props) {
			return h("button", { className: "dtb_track", "data-on": props.on, onClick: props.onToggle, "aria-pressed": props.on },
				h("span", { className: "dtb_thumb" }));
		}
		function CheckRow(props) {
			return h("button", { className: "dtb_check", onClick: props.onToggle },
				h("span", { className: "dtb_box", "data-on": props.on }, props.on ? h(p.IconCheckOutline14, { size: 12 }) : null),
				h("span", null, props.label));
		}
		function BackBar(props) {
			return h("button", { className: "dtb_back", onClick: props.onBack },
				h(p.IconChevronLeftOutline14, { size: 14 }), props.t("back"));
		}
		//#endregion

		//#region archived page
		function ArchivedPage({ ctx, t, onBack }) {
			const [items, setItems] = React.useState(undefined);
			const [error, setError] = React.useState(null);
			const [busyId, setBusyId] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			const [confirming, setConfirming] = React.useState(null);
			const listState = useSnapshot(
				(cb) => ctx.sessions.list.subscribe(cb),
				() => ctx.sessions.list.getSnapshot(),
			);

			const reload = React.useCallback(() => {
				let alive = true;
				setError(null);
				callHost("/api/dsh-better/archived").then(({ payload }) => {
					if (!alive) return;
					if (payload?.ok) setItems(payload.items ?? []);
					else setError(payload?.error ?? "failed");
				}).catch(() => { if (alive) setError("network"); });
				return () => { alive = false; };
			}, []);
			React.useEffect(() => reload(), [reload]);

			const titleOf = React.useCallback((id) => {
				const row = listState.byId[id];
				if (row !== undefined && row.displayTitle !== "" && row.displayTitle !== id) return row.displayTitle;
				if (row?.title) return row.title;
				// Orphaned entry: no list row, so present the stable short id instead.
				return "#" + String(id).replace(/^session-/, "").slice(0, 8);
			}, [listState]);

			const subOf = React.useCallback((item) => {
				const parts = [];
				if (item.headerFound === false) return t("arch.orphan");
				if (item.cwd) parts.push(item.cwd);
				if (item.createdAt) {
					try { parts.push(new Date(item.createdAt).toLocaleString()); } catch { /* keep the raw value out */ }
				}
				if (item.artifact === undefined) parts.push(t("arch.noArtifact"));
				return parts.join(" · ");
			}, [t]);

			async function act(id, action) {
				setBusyId(id);
				setNotice(null);
				try {
					const { payload } = await callHost(action === "restore" ? "/api/dsh-better/restore" : "/api/dsh-better/delete", { sessionId: id });
					if (payload?.ok) {
						setNotice({ ok: true, key: action === "restore" ? "arch.restored" : "arch.deleted" });
						reload();
					} else {
						setNotice({ ok: false, text: (payload?.error ?? "failed") + (payload?.message ? ": " + payload.message : "") });
					}
				} catch {
					setNotice({ ok: false, text: "network" });
				} finally {
					setBusyId(null);
					setConfirming(null);
				}
			}

			const rows = items ?? [];
			return h("div", { className: "dtb_page" },
				h(BackBar, { t, onBack }),
				h("div", { className: "dtb_title" }, t("arch.title")),
				h("p", { className: "dtb_intro" }, t("arch.intro")),
				notice !== null && h("div", { className: "dtb_note" + (notice.ok ? " dtb_oknote" : "") },
					notice.ok ? t(notice.key) : t("arch.failed") + " (" + notice.text + ")"),
				items === undefined
					? h("div", { className: "dtb_empty" }, t("arch.loading"))
					: rows.length === 0
						? h("div", { className: "dtb_empty" }, h(p.IconArchiveOutline20, { size: 20 }), t("arch.empty"))
						: h("div", { className: "dtb_rows" }, rows.map((item) =>
							h(ArchivedRow, {
								key: item.id, item, t, busy: busyId === item.id, titleOf, subOf,
								onAction: act, confirming, setConfirming,
							}))),
				confirming !== null && h(p.Modal, {
					open: true,
					onClose: () => setConfirming(null),
					title: t("arch.deleteTitle"),
					closeLabel: t("arch.cancel"),
				},
					h("p", { style: { margin: "0 0 14px", color: "var(--dsw-alias-label-secondary)", fontSize: 13, lineHeight: "20px" } }, t("arch.deleteBody")),
					h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
						h("button", { className: "dtb_btn", onClick: () => setConfirming(null) }, t("arch.cancel")),
						h("button", { className: "dtb_btn", style: { color: "var(--dsw-alias-state-error-primary)" }, disabled: busyId !== null, onClick: () => act(confirming, "delete") }, t("arch.confirmDelete")))),
			);
		}

		function ArchivedRow({ item, t, busy, titleOf, subOf, onAction, confirming, setConfirming }) {
			const [menuOpen, setMenuOpen] = React.useState(false);
			const menuItems = [
				{ id: "restore", label: t("arch.restore"), icon: h(p.IconRefreshOutline16, { size: 16 }) },
				{ id: "delete", label: t("arch.delete"), icon: h(p.IconTrashOutline16, { size: 16 }), danger: true },
			];
			return h("div", { className: "dtb_row" },
				h("span", { className: "dtb_rowIcon" }, h(p.IconFolderClose16, { size: 16 })),
				h("div", { className: "dtb_rowMain" },
					h("span", { className: "dtb_rowTitle" }, titleOf(item.id)),
					h("span", { className: "dtb_rowSub" }, subOf(item))),
				busy
					? h("span", { className: "dtb_more" }, h(p.IconLoadingOutline16, { size: 16 }))
					: h(p.Menu, {
						open: menuOpen,
						onClose: () => setMenuOpen(false),
						align: "end",
						portal: true,
						items: menuItems,
						onSelect: (id) => {
							setMenuOpen(false);
							if (id === "restore") onAction(item.id, "restore");
							else setConfirming(item.id);
						},
						anchor: h("button", {
							className: "dtb_more",
							"data-open": menuOpen,
							onClick: (e) => { e.stopPropagation(); setMenuOpen((v) => !v); },
							"aria-label": t("arch.more"),
						}, h(p.IconEllipsisOutline16, { size: 16 })),
					}),
			);
		}
		//#endregion

		//#region notifications page
		function NotifyPage({ t, onBack }) {
			const settings = useSnapshot(subscribeNotifySettings, () => notifySettings);
			const supported = typeof Notification !== "undefined";
			const permission = supported ? Notification.permission : "unsupported";
			const [flash, setFlash] = React.useState(null);

			async function enable(on) {
				if (!on) { updateNotifySettings({ enabled: false }); return; }
				if (!supported) { updateNotifySettings({ enabled: false }); return; }
				let next = Notification.permission;
				if (next === "default") {
					try { next = await Notification.requestPermission(); } catch { next = "denied"; }
				}
				updateNotifySettings({ enabled: next === "granted" });
				setFlash(next === "granted" ? null : "permission:" + next);
			}

			async function test() {
				const icon = await whaleIconDataUrl();
				try {
					const toast = new Notification("dsh-better", { body: t("ntf.testSent"), ...(icon === undefined ? {} : { icon }) });
					toast.onclick = () => { try { window.focus(); } catch {} };
					setFlash(null);
				} catch { setFlash("send-failed"); }
			}

			const permPill = !supported
				? t("ntf.permUnsupported")
				: permission === "granted" ? t("ntf.permGranted") : permission === "denied" ? t("ntf.permDenied") : t("ntf.permDefault");

			return h("div", { className: "dtb_page" },
				h(BackBar, { t, onBack }),
				h("div", { className: "dtb_title" }, t("ntf.title")),
				h("p", { className: "dtb_intro" }, t("ntf.intro")),
				h("div", { className: "dtb_card" },
					h("div", { className: "dtb_switchRow" },
						h("div", { className: "dtb_switchText" },
							h("span", { className: "dtb_switchLabel" }, t("ntf.enable")),
							h("span", { className: "dtb_switchDesc" }, t("ntf.enableDesc"))),
						h(Toggle, { on: settings.enabled, onToggle: () => enable(!settings.enabled) })),
					h("div", { className: "dtb_perm" },
						h("span", { className: "dtb_pill" }, permPill),
						supported && permission === "default" && h("button", { className: "dtb_btn", onClick: () => enable(true) }, t("ntf.request")),
						supported && settings.enabled && permission === "granted" && h("button", { className: "dtb_btn", onClick: test }, t("ntf.test")))),
				h("div", { className: "dtb_card" },
					h("span", { className: "dtb_switchLabel" }, t("ntf.events")),
					h(CheckRow, { label: t("ntf.evOptions"), on: settings.options, onToggle: () => updateNotifySettings({ options: !settings.options }) }),
					h(CheckRow, { label: t("ntf.evDone"), on: settings.done, onToggle: () => updateNotifySettings({ done: !settings.done }) }),
					h(CheckRow, { label: t("ntf.evError"), on: settings.error, onToggle: () => updateNotifySettings({ error: !settings.error }) })),
				flash !== null && h("div", { className: "dtb_note" }, flash),
			);
		}
		//#endregion

		//#region update page
		const NPM_UPDATE_COMMANDS_TEXT = [
			"npm install -g @deepseek-ai/dsh@latest",
			"npx @deepseek-ai/dsh@latest web",
		].join("\n");
		const SOURCE_UPDATE_COMMANDS_TEXT = [
			":: Stop the running backend first (quit the launcher / close the dsh web terminal).",
			"cd <your deepseek-harness checkout directory>",
			"git checkout -- package.json",
			"git pull",
			"pnpm install",
			"pnpm run build",
			":: Start dsh again (launcher or: pnpm dsh web)",
		].join("\n");

		function formatReleaseDate(value) {
			try {
				const date = new Date(value);
				return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
			} catch {
				return value;
			}
		}

		function UpdatePage({ t, onBack }) {
			const [state, setState] = React.useState({ phase: "loading" });
			const [copyFlash, setCopyFlash] = React.useState(null);
			const [termMsg, setTermMsg] = React.useState(null);

			const load = React.useCallback(() => {
				let alive = true;
				setState({ phase: "loading" });
				callHost("/api/dsh-better/update-check").then(
					({ payload }) => { if (alive) setState({ phase: "done", payload }); },
					() => { if (alive) setState({ phase: "done", payload: { ok: false, error: t("upd.network") } }); },
				);
				return () => { alive = false; };
			}, [t]);
			React.useEffect(() => load(), [load]);

			async function copyCommands(text) {
				try {
					if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("no-api");
					await navigator.clipboard.writeText(text);
					setCopyFlash(true);
				} catch {
					try {
						const area = document.createElement("textarea");
						area.value = text;
						area.setAttribute("readonly", "");
						area.style.position = "fixed";
						area.style.opacity = "0";
						document.body.appendChild(area);
						area.select();
						const copied = document.execCommand("copy");
						area.remove();
						setCopyFlash(copied === true);
					} catch {
						setCopyFlash(false);
					}
				}
			}

			async function openTerminal() {
				setTermMsg(null);
				try {
					const { payload } = await callHost("/api/dsh-better/open-terminal", {});
					if (payload?.ok) setTermMsg({ ok: true, path: String(payload.opened ?? "") });
					else setTermMsg({ ok: false, text: String(payload?.error ?? "failed") });
				} catch {
					setTermMsg({ ok: false, text: t("upd.network") });
				}
			}

			const data = state.phase === "done" ? state.payload : undefined;
			const current = data?.ok === true ? data.current : undefined;
			const latest = data?.latest ?? undefined;
			const status = data?.status;

			const kindLabel = current === undefined ? undefined
				: current.installKind === "source" ? t("upd.kindSource")
				: current.installKind === "packaged" ? t("upd.kindPackaged")
				: t("upd.kindUnknown");
			const statusColor = status === "up-to-date" ? "#2ea44f" : status === "update-available" ? "#e8a33d" : "var(--dsw-alias-label-caption)";
			const statusText = status === "up-to-date" ? t("upd.uptodate")
				: status === "update-available" ? t("upd.available")
				: t("upd.unknown");

			return h("div", { className: "dtb_page" },
				h(BackBar, { t, onBack }),
				h("div", { className: "dtb_title" }, t("upd.title")),
				h("p", { className: "dtb_intro" }, t("upd.intro")),
				state.phase === "loading"
					? h("div", { className: "dtb_empty" }, t("upd.checking"))
					: data?.ok !== true
						? h("div", { className: "dtb_note" }, t("upd.latestFailed") + " (" + String(data?.error ?? "unknown") + ")")
						: h(React.Fragment, null,
							h("div", { className: "dtb_card" },
								h("div", { className: "dtb_kv" },
									h("span", { className: "dtb_kvLabel" }, t("upd.current")),
									h("span", { className: "dtb_kvValue" }, current.version ?? t("upd.kindUnknown"))),
								h("div", { className: "dtb_kv" },
									h("span", { className: "dtb_kvLabel" }, t("upd.latest")),
									h("span", { className: "dtb_kvValue" }, latest !== undefined ? latest.version : "—")),
								h("div", { className: "dtb_kv" },
									h("span", { className: "dtb_kvLabel" }, t("upd.kind")),
									h("span", { className: "dtb_kvValue" }, kindLabel)),
								current.root !== null && current.root !== undefined && h("div", { className: "dtb_kv" },
									h("span", { className: "dtb_kvLabel" }, t("upd.dir")),
									h("span", { className: "dtb_kvValue" }, current.root))),
							h("div", { className: "dtb_statusRow" },
								h("span", { className: "dtb_dot", style: { background: statusColor } }),
								h("span", { className: "dtb_switchLabel" }, statusText),
								latest !== undefined && latest.prerelease === true
									? h("span", { className: "dtb_pill" }, t("upd.prerelease")) : null,
								data.stale === true || (latest !== undefined && latest.stale === true)
									? h("span", { className: "dtb_pill" }, t("upd.stale")) : null,
								latest !== undefined && latest.name !== undefined && latest.name !== latest.version
									? h("span", { className: "dtb_entryDesc" }, latest.name) : null,
								latest !== undefined && latest.publishedAt !== undefined
									? h("span", { className: "dtb_entryDesc" }, t("upd.published") + " " + formatReleaseDate(latest.publishedAt)) : null,
								data.latestError !== undefined && latest === undefined
									? h("span", { className: "dtb_entryDesc" }, t("upd.latestFailed") + " (" + data.latestError + ")") : null),
							h("div", { className: "dtb_actions" },
								h("button", { className: "dtb_btn", onClick: load }, t("upd.refresh")),
								latest !== undefined && latest.url !== undefined
									? h("a", { className: "dtb_btn", href: latest.url, target: "_blank", rel: "noreferrer" }, t("upd.releases"))
									: null),
							copyFlash !== null && h("div", { className: "dtb_note" + (copyFlash === true ? " dtb_oknote" : "") },
								copyFlash === true ? t("upd.copied") : t("upd.copyFailed")),
							h("div", { className: "dtb_card" },
								h("span", { className: "dtb_switchLabel" }, t("upd.cmdTitle")),
								h("p", { className: "dtb_intro", style: { margin: "4px 0 0" } }, t("upd.note")),
								h("div", { className: "dtb_entryDesc", style: { marginTop: "10px" } }, t("upd.npmTitle")),
								h("div", { className: "dtb_codeWrap" },
									h("pre", { className: "dtb_code" }, NPM_UPDATE_COMMANDS_TEXT),
									h("button", { className: "dtb_btn dtb_copyBtn", onClick: () => copyCommands(NPM_UPDATE_COMMANDS_TEXT) }, t("upd.copy"))),
								h("div", { className: "dtb_entryDesc", style: { marginTop: "12px" } }, t("upd.srcTitle")),
								h("div", { className: "dtb_codeWrap" },
									h("pre", { className: "dtb_code" }, SOURCE_UPDATE_COMMANDS_TEXT),
									h("button", { className: "dtb_btn dtb_copyBtn", onClick: () => copyCommands(SOURCE_UPDATE_COMMANDS_TEXT) }, t("upd.copy")))),
							h("div", { className: "dtb_card" },
								h("span", { className: "dtb_switchLabel" }, t("upd.termTitle")),
								h("p", { className: "dtb_intro", style: { margin: "4px 0 10px" } }, t("upd.termDesc")),
								h("div", { className: "dtb_actions", style: { marginTop: 0 } },
									h("button", {
										className: "dtb_btn",
										disabled: !current.root,
										style: current.root ? undefined : { opacity: 0.5, cursor: "not-allowed" },
										onClick: openTerminal,
									}, t("upd.openTerm")),
									!current.root && h("span", { className: "dtb_entryDesc", style: { alignSelf: "center" } }, t("upd.noDir"))),
								termMsg !== null && h("div", { className: "dtb_note" + (termMsg.ok ? " dtb_oknote" : ""), style: { marginTop: 10 } },
									termMsg.ok ? t("upd.termOpened") + " " + termMsg.path : t("upd.termFailed") + " (" + termMsg.text + ")"))),
			);
		}
		//#endregion

		//#region model routing page
		const ROUTER_SNAPSHOT_PATH = "/api/dsh-better/model-router";
		const ROUTER_SAVE_PATH = "/api/dsh-better/model-router/save";
		const ROUTER_APPLY_PATH = "/api/dsh-better/model-router/apply";
		const ROUTER_EFFORTS_PATH = "/api/dsh-better/model-router/efforts";

		let mrRuleSeq = 0;
		function mrEmptyRule() {
			mrRuleSeq += 1;
			return { id: "rule-" + Date.now().toString(36) + "-" + mrRuleSeq, enabled: true, keywords: "", provider: "", model: "", effort: "" };
		}

		function mrDraftOf(config) {
			return {
				enabled: config?.enabled !== false,
				matchCase: config?.matchCase === true,
				rules: (Array.isArray(config?.rules) ? config.rules : []).map((rule) => ({
					id: String(rule?.id ?? ""),
					enabled: rule?.enabled !== false,
					keywords: (Array.isArray(rule?.keywords) ? rule.keywords : []).join(", "),
					provider: rule?.target?.provider ?? "",
					model: rule?.target?.model ?? "",
					effort: rule?.target?.reasoningEffort ?? "",
				})),
				agentEnabled: config?.agentSwitch?.enabled === true,
				allow: (Array.isArray(config?.agentSwitch?.allow) ? config.agentSwitch.allow : []).map((entry) => ({
					provider: entry?.provider ?? "",
					model: entry?.model ?? "",
					effort: entry?.reasoningEffort ?? "",
				})),
			};
		}

		function mrValueOf(draft) {
			return {
				enabled: draft.enabled,
				matchCase: draft.matchCase,
				rules: draft.rules.map((rule, index) => {
					const keywords = rule.keywords.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
					const provider = rule.provider.trim();
					const model = rule.model.trim();
					const effort = rule.effort.trim();
					return {
						id: rule.id.trim().length > 0 ? rule.id.trim() : "rule-" + Date.now().toString(36) + "-" + index,
						enabled: rule.enabled,
						keywords,
						target: { provider, model, ...(effort.length === 0 ? {} : { reasoningEffort: effort }) },
					};
				}).filter((rule) => rule.keywords.length > 0 && rule.target.provider.length > 0 && rule.target.model.length > 0),
				agentSwitch: {
					enabled: draft.agentEnabled,
					allow: draft.allow.map((entry) => {
						const provider = entry.provider.trim();
						const model = entry.model.trim();
						const effort = entry.effort.trim();
						return { provider, model, ...(effort.length === 0 ? {} : { reasoningEffort: effort }) };
					}).filter((entry) => entry.provider.length > 0 && entry.model.length > 0),
				},
			};
		}

		function mrField(label, hint, control) {
			return h("label", { className: "dtb_mr_field" },
				h("span", null, label),
				control,
				hint === undefined ? null : h("span", { className: "dtb_mr_hint" }, hint));
		}

		function mrProviderField(t, providers, value, onChange) {
			const active = providers.filter((row) => row.active);
			const dormant = providers.filter((row) => !row.active);
			return mrField(t("mr.targetProvider"), undefined,
				h("select", { value, onChange: (event) => onChange(event.target.value) },
					h("option", { value: "" }, "—"),
					active.length > 0 ? h("optgroup", { label: t("mr.activeGroup") },
						active.map((row) => h("option", { key: row.provider, value: row.provider },
							row.displayName && row.displayName !== row.provider ? row.displayName + " (" + row.provider + ")" : row.provider))) : null,
					dormant.length > 0 ? h("optgroup", { label: t("mr.dormantGroup") },
						dormant.map((row) => h("option", { key: row.provider, value: row.provider }, row.provider))) : null));
		}

		function mrModelField(t, models, listId, value, onChange) {
			return mrField(t("mr.targetModel"), undefined, [
				h("input", { key: "input", value, list: listId, autoComplete: "off",
					onChange: (event) => onChange(event.target.value) }),
				h("datalist", { key: "list", id: listId },
					models.map((model) => h("option", { key: model.id, value: model.id }))),
			]);
		}

		function mrEffortField(t, efforts, value, onChange) {
			const list = Array.isArray(efforts) ? efforts : [];
			return mrField(t("mr.targetEffort"), t("mr.effortHint"),
				h("select", { value, disabled: list.length === 0 && value.length === 0,
					onChange: (event) => onChange(event.target.value) },
					h("option", { value: "" }, "—"),
					list.map((entry) => h("option", { key: entry.id, value: entry.id },
						entry.name && entry.name !== entry.id ? entry.name + " (" + entry.id + ")" : entry.id))));
		}

		function MrKvRow(label, value) {
			return h("div", { className: "dtb_kv" },
				h("span", { className: "dtb_kvLabel" }, label),
				h("span", { className: "dtb_kvValue" }, value));
		}

		function RuleRow({ rule, index, snap, validated, effortsMap, onPatch, onRemove, onApply, applying, busy, t, loadEfforts }) {
			const providers = snap.providers ?? [];
			const models = snap.modelsByProvider?.[rule.provider] ?? [];
			const catalogError = rule.provider.length > 0 ? snap.catalogError?.[rule.provider] : undefined;
			const dormant = providers.find((row) => row.provider === rule.provider)?.active === false;
			const effKey = rule.provider.trim() + "/" + rule.model.trim();
			const effortEntry = effortsMap[effKey];
			React.useEffect(() => {
				if (rule.provider.trim().length > 0 && rule.model.trim().length > 0 && effortEntry === undefined) {
					loadEfforts(rule.provider.trim(), rule.model.trim());
				}
			}, [rule.provider, rule.model, effortEntry, loadEfforts]);
			return h("div", { className: "dtb_mr_rule" },
				h("div", { className: "dtb_mr_ruleTop" },
					h("span", { className: "dtb_mr_index" }, String(index + 1)),
					h(Toggle, { on: rule.enabled, onToggle: () => onPatch({ enabled: !rule.enabled }) }),
					rule.enabled && validated === true
						? h("span", { className: "dtb_mr_validBadge", title: t("mr.validated") }, t("mr.activeBadge"))
						: rule.enabled
							? h("span", { className: "dtb_mr_invalidBadge", title: t("mr.invalidHint") }, t("mr.inactiveBadge"))
							: null,
					dormant ? h("span", { className: "dtb_pill dtb_mr_badgeWarn" }, t("mr.dormantGroup")) : null,
					catalogError !== undefined ? h("span", { className: "dtb_pill dtb_mr_badgeErr", title: catalogError }, t("mr.catalogError")) : null,
					h("span", { className: "dtb_mr_spacer" }),
					h("button", {
						className: "dtb_mr_btn", disabled: busy || applying || rule.provider.trim().length === 0 || rule.model.trim().length === 0,
						onClick: onApply,
					}, applying ? "…" : t("mr.applySession")),
					h("button", {
						className: "dtb_mr_btnGhost dtb_mr_btnDanger", disabled: busy,
						onClick: onRemove,
					}, t("mr.remove"))),
				h("div", { className: "dtb_mr_grid" },
					mrField(t("mr.ruleKeywords"), t("mr.ruleKeywordsHint"),
						h("input", { value: rule.keywords, placeholder: "汇总, summary", autoComplete: "off",
							onChange: (event) => onPatch({ keywords: event.target.value }) })),
					mrProviderField(t, providers, rule.provider, (provider) => onPatch({ provider, model: "", effort: "" })),
					mrModelField(t, models, "dtb-mr-models-" + rule.id, rule.model, (model) => onPatch({ model, effort: "" })),
					mrEffortField(t, effortEntry, rule.effort, (effort) => onPatch({ effort }))));
		}

		function RouterPage({ ctx, t, onBack }) {
			const [state, setState] = React.useState({ phase: "loading" });
			const [draft, setDraft] = React.useState(undefined);
			const [notice, setNotice] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [applyingId, setApplyingId] = React.useState(null);
			const [effortsMap, setEffortsMap] = React.useState({});

			const snap = state.phase === "ready" ? state.snap : undefined;

			const currentSessionId = React.useCallback(() => {
				try {
					const current = ctx.sessions.list.getSnapshot().current;
					return current === undefined || current === null ? undefined : String(current);
				} catch { return undefined; }
			}, [ctx]);

			const load = React.useCallback(() => {
				let alive = true;
				setState({ phase: "loading" });
				const sid = currentSessionId();
				const qs = sid === undefined ? "" : "?sessionId=" + encodeURIComponent(sid);
				callHost(ROUTER_SNAPSHOT_PATH + qs).then(
					({ payload }) => {
						if (!alive) return;
						if (payload?.ok === true) {
							setState({ phase: "ready", snap: payload });
							// Build the editor draft ONCE. Later snapshot refreshes
							// (apply/status polls) must never clobber in-progress edits.
							setDraft((cur) => cur ?? mrDraftOf(payload.config));
						} else {
							setState({ phase: "error", text: String(payload?.message ?? payload?.error ?? "unknown") });
						}
					},
					() => { if (alive) setState({ phase: "error", text: t("mr.network") }); },
				);
				return () => { alive = false; };
			}, [currentSessionId, t]);
			React.useEffect(() => load(), [load]);

			const loadEfforts = React.useCallback((provider, model) => {
				const key = provider + "/" + model;
				setEffortsMap((prev) => (prev[key] === undefined ? { ...prev, [key]: null } : prev));
				callHost(ROUTER_EFFORTS_PATH + "?provider=" + encodeURIComponent(provider) + "&model=" + encodeURIComponent(model)).then(
					({ payload }) => {
						setEffortsMap((prev) => ({ ...prev, [key]: payload?.ok === true && Array.isArray(payload.efforts) ? payload.efforts : [] }));
					},
					() => {
						setEffortsMap((prev) => ({ ...prev, [key]: [] }));
					},
				);
			}, []);

			async function save() {
				if (snap === undefined || draft === undefined) return false;
				setBusy(true);
				setNotice(null);
				try {
					// Tell the host which session this page is editing: the echoed
					// snapshot then carries a live `effective`, so the "current
					// session selection" row survives the save instead of flipping
					// to "no active session".
					const sid = currentSessionId();
					const { payload } = await callHost(ROUTER_SAVE_PATH, {
						value: mrValueOf(draft),
						expectedRevision: snap.revision,
						...(sid === undefined ? {} : { sessionId: sid }),
					});
					if (payload?.ok === true && payload.available === true) {
						// Adopt the persisted snapshot and rebuild the draft from it,
						// so saved rules / allowlist / switches are ALWAYS visible
						// immediately after save.
						setState({ phase: "ready", snap: payload });
						setDraft(mrDraftOf(payload.config));
						setNotice({ ok: true, key: "mr.saved" });
						return true;
					}
					if (payload?.error === "conflict") {
						setNotice({ ok: false, text: t("mr.conflict") });
					} else if (payload?.error === "invalid-config") {
						setNotice({ ok: false, text: t("mr.invalid") + "：" + String(payload?.message ?? "") });
					} else if (payload?.ok === true) {
						setNotice({ ok: false, text: t("mr.unavailable") + " " + String(payload?.reason ?? "") });
					} else {
						setNotice({ ok: false, text: t("mr.loadFailed") + " (" + String(payload?.error ?? "unknown") + ")" });
					}
					return false;
				} catch {
					setNotice({ ok: false, text: t("mr.network") });
					return false;
				} finally {
					setBusy(false);
				}
			}

			async function applyToSession(rule) {
				// Persist FIRST: an unsaved rule would be wiped by the refresh below
				// (the snapshot still holds the old config), and the applied target
				// must match what is on disk.
				const savedOk = await save();
				if (!savedOk) return;
				const sid = currentSessionId();
				if (sid === undefined) {
					setNotice({ ok: false, text: t("mr.noSession") });
					return;
				}
				setApplyingId(rule.id);
				try {
					const effort = rule.effort.trim();
					const { payload } = await callHost(ROUTER_APPLY_PATH, {
						sessionId: sid,
						target: { provider: rule.provider.trim(), model: rule.model.trim(), ...(effort.length === 0 ? {} : { reasoningEffort: effort }) },
					});
					if (payload?.ok === true) {
						setNotice({ ok: true, key: "mr.appliedOk" });
						// STATUS-ONLY refresh: update effective/validated badges but
						// keep the draft untouched so every rule stays exactly as shown.
						const sres = await callHost(ROUTER_SNAPSHOT_PATH + "?sessionId=" + encodeURIComponent(sid));
						if (sres.payload?.ok === true) setState({ phase: "ready", snap: sres.payload });
					} else {
						setNotice({ ok: false, text: String(payload?.message ?? payload?.error ?? "failed") });
					}
				} catch {
					setNotice({ ok: false, text: t("mr.network") });
				} finally {
					setApplyingId(null);
				}
			}

			if (state.phase === "loading" && snap === undefined) {
				return h("div", { className: "dtb_page" },
					h(BackBar, { t, onBack }),
					h("div", { className: "dtb_title" }, t("mr.title")),
					h("div", { className: "dtb_empty" }, t("mr.loading")));
			}
			if (state.phase === "error" || snap === undefined) {
				return h("div", { className: "dtb_page" },
					h(BackBar, { t, onBack }),
					h("div", { className: "dtb_title" }, t("mr.title")),
					h("div", { className: "dtb_note" }, t("mr.loadFailed") + " (" + String(state.text ?? "") + ")"),
					h("div", { className: "dtb_actions" },
						h("button", { className: "dtb_btn", onClick: load }, t("upd.refresh"))));
			}
			if (snap.available !== true) {
				return h("div", { className: "dtb_page" },
					h(BackBar, { t, onBack }),
					h("div", { className: "dtb_title" }, t("mr.title")),
					h("div", { className: "dtb_note" }, t("mr.unavailable") + (snap.reason ? "：" + snap.reason : "")));
			}
			if (draft === undefined) return null;

			const updateRule = (index, patch) => setDraft((cur) => ({ ...cur, rules: cur.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) }));
			const updateAllow = (index, patch) => setDraft((cur) => ({ ...cur, allow: cur.allow.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) }));

			const effective = snap.effective;
			const selText = (selection) => selection === null || selection === undefined
				? "—"
				: selection.provider + "/" + selection.model + (selection.reasoningEffort === undefined ? "" : " (" + selection.reasoningEffort + ")");
			const effectiveText = effective === null || effective === undefined
				? t("mr.noSession")
				: selText(effective.selection) + " · " + (effective.source === "session" ? t("mr.sourceSession") : t("mr.sourceDefault"));
			const toolRegistered = snap.features?.modelRouteRegistered === true;

			return h("div", { className: "dtb_page" },
				h(BackBar, { t, onBack }),
				h("div", { className: "dtb_title" }, t("mr.title")),
				h("p", { className: "dtb_intro" }, t("mr.intro")),
				h("div", { className: "dtb_card" },
					h("div", { className: "dtb_statusRow", style: { padding: "0 0 4px" } },
						h("span", { className: "dtb_dot", style: { background: draft.enabled ? "#2ea44f" : "var(--dsw-alias-label-caption)" } }),
						h("span", { className: "dtb_switchLabel" }, t("mr.statusEngine") + "："),
						h("span", { className: "dtb_switchLabel", style: { color: draft.enabled ? "#2ea44f" : "var(--dsw-alias-label-caption)" } }, draft.enabled ? t("mr.on") : t("mr.off"))),
					MrKvRow(t("mr.effective"), effectiveText),
					MrKvRow(t("mr.rulesCount"), String(draft.rules.filter((rule) => rule.enabled).length) + " / " + String(draft.rules.length)),
					MrKvRow(t("mr.featureTool"), toolRegistered ? t("mr.registered") : t("mr.unregistered")),
					MrKvRow(t("mr.defaultModel"), selText(snap.defaultModel))),
				h("div", { className: "dtb_card" },
					h("div", { className: "dtb_switchRow" },
						h("div", { className: "dtb_switchText" },
							h("span", { className: "dtb_switchLabel" }, t("mr.masterEnable")),
							h("span", { className: "dtb_switchDesc" }, t("mr.masterDesc"))),
						h(Toggle, { on: draft.enabled, onToggle: () => setDraft({ ...draft, enabled: !draft.enabled }) })),
					draft.enabled ? h(CheckRow, {
						label: t("mr.matchCase"), on: draft.matchCase,
						onToggle: () => setDraft({ ...draft, matchCase: !draft.matchCase }),
					}) : null),
				h("div", { className: "dtb_card" },
					h("div", { className: "dtb_switchRow" },
						h("div", { className: "dtb_switchText" },
							h("span", { className: "dtb_switchLabel" }, t("mr.rules")),
							h("span", { className: "dtb_switchDesc" }, t("mr.rulesHint"))),
						h("button", { className: "dtb_mr_btnGhost", disabled: busy, onClick: () => setDraft({ ...draft, rules: [...draft.rules, mrEmptyRule()] }) }, t("mr.addRule"))),
					draft.rules.map((rule, index) => h(RuleRow, {
						key: rule.id, rule, index, snap, effortsMap, busy,
						validated: (snap.validatedRuleIds ?? []).includes(rule.id),
						applying: applyingId === rule.id,
						onPatch: (patch) => updateRule(index, patch),
						onRemove: () => setDraft({ ...draft, rules: draft.rules.filter((_, i) => i !== index) }),
						onApply: () => applyToSession(rule),
						t, loadEfforts,
					}))),
				h("div", { className: "dtb_card" },
					h("div", { className: "dtb_switchRow" },
						h("div", { className: "dtb_switchText" },
							h("span", { className: "dtb_switchLabel" }, t("mr.allowTitle")),
							h("span", { className: "dtb_switchDesc" }, t("mr.allowDesc"))),
						h(Toggle, { on: draft.agentEnabled, onToggle: () => setDraft({ ...draft, agentEnabled: !draft.agentEnabled }) })),
					draft.agentEnabled ? h(React.Fragment, null,
						h("div", { className: "dtb_mr_ruleTop", style: { marginTop: 12 } },
							h("span", { className: "dtb_switchLabel" }, t("mr.allowEntries")),
							h("span", { className: "dtb_mr_spacer" }),
							h("button", { className: "dtb_mr_btnGhost", disabled: busy, onClick: () => setDraft({ ...draft, allow: [...draft.allow, { provider: "", model: "", effort: "" }] }) }, t("mr.addAllow"))),
						draft.allow.map((entry, index) => h("div", { className: "dtb_mr_allowEntry", key: "allow-" + index },
							h("div", { className: "dtb_mr_grid3" },
								mrProviderField(t, snap.providers ?? [], entry.provider, (provider) => updateAllow(index, { provider, model: "", effort: "" })),
								mrModelField(t, snap.modelsByProvider?.[entry.provider] ?? [], "dtb-mr-allow-" + index, entry.model, (model) => updateAllow(index, { model, effort: "" })),
								mrEffortField(t, effortsMap[entry.provider.trim() + "/" + entry.model.trim()], entry.effort, (effort) => updateAllow(index, { effort }))),
							h("div", { className: "dtb_mr_ruleTop" },
								h("span", { className: "dtb_mr_spacer" }),
								h("button", {
									className: "dtb_mr_btnGhost dtb_mr_btnDanger", disabled: busy,
									onClick: () => setDraft({ ...draft, allow: draft.allow.filter((_, i) => i !== index) }),
								}, t("mr.remove"))))),
						draft.allow.length === 0 ? h("p", { className: "dtb_intro", style: { margin: "10px 0 0" } }, t("mr.allowEmpty")) : null)
						: null),
				notice !== null && h("div", { className: "dtb_note" + (notice.ok === true ? " dtb_oknote" : "") },
					notice.ok === true ? t(notice.key) : notice.text),
				h("div", { className: "dtb_actions" },
					h("button", { className: "dtb_mr_btn", disabled: busy, onClick: save }, busy ? t("mr.saving") : t("mr.save")),
					h("button", { className: "dtb_mr_btnGhost", disabled: busy, onClick: () => { setDraft(mrDraftOf(snap.config)); setNotice(null); } }, t("mr.discard"))),
			);
		}

		/** Keyed chat-card view for the model_route tool (running / success / error). */
		function ModelRouteCard(props) {
			const t = props.t ?? ((key) => key);
			const block = props.block;
			const settled = block !== null && typeof block === "object" && typeof block.kind === "string";
			const failed = settled && block.isError === true;
			let applied;
			if (settled && !failed) {
				let raw = block.meta;
				if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
					const text = (Array.isArray(block.content) ? block.content : [])
						.filter((entry) => entry?.type === "text").map((entry) => entry.text).join("\n").trim();
					if (text.length > 0) {
						try { raw = JSON.parse(text); } catch { raw = undefined; }
					}
				}
				if (raw !== null && typeof raw === "object" && !Array.isArray(raw)
					&& raw.applied !== null && typeof raw.applied === "object"
					&& typeof raw.applied.provider === "string" && typeof raw.applied.model === "string") {
					applied = raw.applied;
				}
			}
			let sub;
			if (!settled) sub = t("mr.cardRunning");
			else if (failed) {
				sub = (Array.isArray(block.content) ? block.content : [])
					.filter((entry) => entry?.type === "text").map((entry) => entry.text).join("\n").split("\n")[0]
					|| t("mr.cardFailed");
			} else if (applied !== undefined) {
				sub = applied.provider + "/" + applied.model
					+ (applied.reasoningEffort === undefined || applied.reasoningEffort === null ? "" : " (" + applied.reasoningEffort + ")")
					+ " · " + t("mr.cardNext");
			} else sub = t("mr.cardDone");
			return h("div", { className: "dtb_row dtb_mr_card", "data-state": !settled ? "running" : failed ? "error" : "success" },
				h("span", { className: "dtb_rowIcon" }, h(p.IconBranchOutline16, { size: 16 })),
				h("div", { className: "dtb_rowMain" },
					h("span", { className: "dtb_rowTitle" }, t("mr.cardTitle")),
					h("span", { className: "dtb_rowSub" }, sub)));
		}
		//#endregion

		//#region error boundary
		/** Section-local boundary: a crash in our UI shows a dismissible note instead of a blank panel. */
		class SectionBoundary extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			componentDidCatch(error, info) {
				try { console.error("[dsh-better] section crashed:", error, info?.componentStack); } catch {}
			}
			render() {
				if (this.state.error !== null) {
					return h("div", { className: "dtb_page" },
						h("div", { className: "dtb_note" },
							"dsh-better UI error: " + String(this.state.error?.message ?? this.state.error)),
						h("button", { className: "dtb_btn", style: { marginTop: 8, width: "fit-content" }, onClick: () => this.setState({ error: null }) }, "Reload UI"));
				}
				return this.props.children;
			}
		}
		//#endregion

		//#region section root
		function BetterSection({ t, ctx }) {
			const [view, setViewState] = React.useState("root");
			if (view === "archived") return h(ArchivedPage, { ctx, t, onBack: () => setViewState("root") });
			if (view === "notify") return h(NotifyPage, { t, onBack: () => setViewState("root") });
			if (view === "update") return h(UpdatePage, { t, onBack: () => setViewState("root") });
			if (view === "router") return h(RouterPage, { ctx, t, onBack: () => setViewState("root") });
			if (view === "scrollnav") return h(ScrollNavPage, { t, onBack: () => setViewState("root") });
			return h("div", { className: "dtb_page" },
				h("div", { className: "dtb_title" }, t("root.title")),
				h("p", { className: "dtb_intro" }, t("root.intro")),
				h("div", { className: "dtb_entries" },
					h("button", { className: "dtb_entry", onClick: () => setViewState("archived") },
						h("span", { className: "dtb_entryIcon" }, h(p.IconArchiveOutline20, { size: 20 })),
						h("span", { className: "dtb_entryMain" },
							h("span", { className: "dtb_entryName" }, t("arch.entry")),
							h("span", { className: "dtb_entryDesc" }, t("arch.entryDesc"))),
						h("span", { className: "dtb_entryChevron" }, h(p.IconChevronRightOutline14, { size: 14 }))),
					h("button", { className: "dtb_entry", onClick: () => setViewState("notify") },
						h("span", { className: "dtb_entryIcon" }, h(p.FishLogo, { size: 22 })),
						h("span", { className: "dtb_entryMain" },
							h("span", { className: "dtb_entryName" }, t("ntf.entry")),
							h("span", { className: "dtb_entryDesc" }, t("ntf.entryDesc"))),
						h("span", { className: "dtb_entryChevron" }, h(p.IconChevronRightOutline14, { size: 14 }))),
					h("button", { className: "dtb_entry", onClick: () => setViewState("update") },
						h("span", { className: "dtb_entryIcon" }, h(p.IconDownloadOutline16, { size: 20 })),
						h("span", { className: "dtb_entryMain" },
							h("span", { className: "dtb_entryName" }, t("upd.entry")),
							h("span", { className: "dtb_entryDesc" }, t("upd.entryDesc"))),
						h("span", { className: "dtb_entryChevron" }, h(p.IconChevronRightOutline14, { size: 14 }))),
					h("button", { className: "dtb_entry", onClick: () => setViewState("router") },
						h("span", { className: "dtb_entryIcon" }, h(p.IconBranchOutline16, { size: 20 })),
						h("span", { className: "dtb_entryMain" },
							h("span", { className: "dtb_entryName" }, t("mr.entry")),
							h("span", { className: "dtb_entryDesc" }, t("mr.entryDesc"))),
						h("span", { className: "dtb_entryChevron" }, h(p.IconChevronRightOutline14, { size: 14 }))),
					h("button", { className: "dtb_entry", onClick: () => setViewState("scrollnav") },
						h("span", { className: "dtb_entryIcon" }, h(p.IconQueueOutline14, { size: 18 })),
						h("span", { className: "dtb_entryMain" },
							h("span", { className: "dtb_entryName" }, t("sn.entry")),
							h("span", { className: "dtb_entryDesc" }, t("sn.entryDesc"))),
						h("span", { className: "dtb_entryChevron" }, h(p.IconChevronRightOutline14, { size: 14 })))),
			);
		}
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots", "locale", "sessions"];

		/**
		 * Client plugin body: register the dictionaries, the settings section, and
		 * the notification engine.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-better: dictionaries");
			ensureCss();

			const t = ctx.locale.bind(NS);

			const engine = createNotificationEngine(ctx, t, {
				get: () => notifySettings,
			});
			engine.install();
			ctx.effect(() => () => engine.dispose(), "dsh-better: notification engine");

			// Keyed chat-card view for the model_route tool (registered by the
			// host half while the allowlist is non-empty).
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
				name: "tool.call.toolview",
				key: "model_route",
				inject: () => ({ t }),
			}, ModelRouteCard));

			// Message scroll nav: one additive entry in the frame-wide floating
			// layer; the layer is click-through and the rail opts back into
			// pointer events itself. The occupant also receives the frame's
			// standard useSessions selector hook for the current session id.
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-better-scroll-nav",
				order: 40,
				label: () => t("sn.nav"),
				inject: () => ({ t, ctx }),
			}, ScrollNavRail));

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "better",
				order: 50,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({ t, ctx }),
			}, function BetterSectionBoundary(props) { return h(SectionBoundary, null, h(BetterSection, props)); }));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.BetterSection = BetterSection;
		return module.exports;
	}
});
