"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { SCENARIOS } from "@/lib/scenarios";
import type { Tab, ThreadItem } from "@/lib/store";
import { cx, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Composer } from "./Composer";
import { Icon, Wordmark, type IconName } from "./Icon";

export function Home({ on }: { on: boolean }) {
  const store = useStore();
  const t = useCopy();
  const threaded = useSpoken((s) => s.threaded);
  const tab = useSpoken((s) => s.tab);

  return (
    <section className={cx("screen", on && "on", threaded && "threaded")} id="home" aria-label="Home">
      <header className="topbar pad">
        <Wordmark />
        <button className="iconbtn newchat" aria-label={t.newChat} onClick={() => store.newChat()}>
          <Icon name="plus" />
        </button>
      </header>
      <div className="panes">
        <ChatPane active={tab === "chat"} />
        <DemoPane active={tab === "demo"} />
        <SettingsPane active={tab === "settings"} />
      </div>
      <TabBar tab={tab} />
    </section>
  );
}

function Pane({ id, active, children }: { id: Tab; active: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("pane", active && "on")} id={`pane-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} hidden={!active}>
      {children}
    </div>
  );
}

/* ---------- chat ---------- */

function ChatPane({ active }: { active: boolean }) {
  const store = useStore();
  const t = useCopy();
  const thread = useSpoken((s) => s.thread);
  const draft = useSpoken((s) => s.draft);
  const asking = useSpoken((s) => s.asking);
  const focusTick = useSpoken((s) => s.focusTick);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const smooth = thread.at(-1)?.kind === "plan" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, [thread]);

  return (
    <Pane id="chat" active={active}>
      <div className="scroll pad" ref={scrollRef}>
        <div className="empty">
          <span className="mark big rise" style={{ "--i": 0 } as CSSProperties} />
          <h1 className="greet rise" style={{ "--i": 1 } as CSSProperties}>
            {t.ask}
          </h1>
          <p className="lede rise" style={{ "--i": 2 } as CSSProperties}>
            {t.askSub}
          </p>
        </div>
        <div id="thread" aria-live="polite">
          {thread.map((item) => (
            <ThreadEntry key={item.id} item={item} />
          ))}
        </div>
      </div>
      <div className="composer pad">
        <div className="chips presets">
          <button className="chip" onClick={() => store.preset("pizza")}>
            <Icon name="pizza" />
            {t.sugPizza}
          </button>
          <button className="chip" onClick={() => store.preset("doctor")}>
            <Icon name="doctor" />
            {t.sugDoctor}
          </button>
        </div>
        <Composer
          value={draft}
          onChange={(v) => store.setDraft(v)}
          onSubmit={() => store.submitDraft()}
          placeholder={asking ? t.answerPh : t.ph}
          label={t.phAria}
          sendLabel={t.send}
          focusTick={focusTick}
        />
      </div>
    </Pane>
  );
}

function ThreadEntry({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "me":
    case "bot":
      return <div className={`bubble ${item.kind}`}>{item.text}</div>;
    case "dots":
      return (
        <div className="bubble bot" style={{ padding: 0 }}>
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      );
    case "q":
      return <QuestionEntry item={item} />;
    case "plan":
      return <PlanCard item={item} />;
  }
}

/** A clarifying question from the call server, with quick answers. */
function QuestionEntry({ item }: { item: Extract<ThreadItem, { kind: "q" }> }) {
  const store = useStore();
  return (
    <>
      <div className="bubble bot">{item.text}</div>
      {!item.answered && item.options.length > 0 && (
        <div className="chips answers">
          {item.options.map((o) => (
            <button key={o} className="chip" onClick={() => store.answer(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function PlanCard({ item }: { item: Extract<ThreadItem, { kind: "plan" }> }) {
  const store = useStore();
  const t = useCopy();
  const lang = useSpoken((s) => s.lang);
  const sc = SCENARIOS[item.scenario];
  const L = sc[lang];
  const p = item.live ?? {
    callee: { name: L.contact, number: sc.number, init: sc.init },
    goal: L.goal,
    checks: L.checks,
    share: [],
    opening: L.opening,
  };

  return (
    <div className="plan">
      <div className="who">
        <span className="av">{p.callee.init}</span>
        <div>
          <b>{p.callee.name}</b>
          <span>{p.callee.number}</span>
        </div>
      </div>
      <div>
        <p className="field-l">{t.planGoal}</p>
        <p>{p.goal}</p>
      </div>
      {p.checks.length > 0 && (
        <div>
          <p className="field-l">{t.planAsk}</p>
          <div className="checks">
            {p.checks.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}
      {p.share.length > 0 && (
        <div>
          <p className="field-l">{t.planShare}</p>
          <div className="checks">
            {p.share.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="field-l">{t.planOpen}</p>
        <div className="quote">“{p.opening}”</div>
      </div>
      <div className="acts">
        <button className={cx("btn primary", item.pressed && "pressed")} onClick={() => store.startCall()}>
          <Icon name="phone" />
          {t.start}
        </button>
        <button className="btn ghost" onClick={() => store.editPlan(item.request)}>
          {t.edit}
        </button>
      </div>
    </div>
  );
}

/* ---------- demo ---------- */

function DemoPane({ active }: { active: boolean }) {
  const store = useStore();
  const t = useCopy();
  const rows = [
    { key: "pizza", title: t.sugPizza, sub: t.sugPizzaSub },
    { key: "doctor", title: t.sugDoctor, sub: t.sugDoctorSub },
  ] as const;

  return (
    <Pane id="demo" active={active}>
      <div className="scroll pad">
        <div className="pane-body">
          <p className="label">{t.demoTab}</p>
          <h2 className="pane-h">{t.demoH}</h2>
          <p className="lede">{t.demoSub}</p>
          <ul className="list">
            {rows.map((r) => (
              <li key={r.key}>
                <button className="row" data-demo={r.key} onClick={() => store.playDemo(r.key)}>
                  <span className="ic">
                    <Icon name={r.key} />
                  </span>
                  <span className="tx">
                    <b>{r.title}</b>
                    <span>{r.sub}</span>
                  </span>
                  <span className="go">
                    <Icon name="play" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Pane>
  );
}

/* ---------- settings ---------- */

function SettingsPane({ active }: { active: boolean }) {
  const store = useStore();
  const t = useCopy();
  const lang = useSpoken((s) => s.lang);

  return (
    <Pane id="settings" active={active}>
      <div className="scroll pad">
        <div className="pane-body">
          <p className="label">{t.setTab}</p>
          <h2 className="pane-h">{t.setH}</h2>
          <ul className="list">
            <li className="row static">
              <span className="tx">
                <b>{t.langL}</b>
                <span>{t.langS}</span>
              </span>
              <div className="seg" role="group" aria-label={t.langL}>
                {(["en", "no"] as const).map((l) => (
                  <button key={l} aria-pressed={lang === l} onClick={() => store.setLang(l)}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </li>
            <li>
              <button className="row" onClick={() => store.replay()}>
                <span className="tx">
                  <b>{t.replay}</b>
                  <span>{t.replayS}</span>
                </span>
                <span className="go">
                  <Icon name="replay" />
                </span>
              </button>
            </li>
            <li className="row static">
              <span className="tx">
                <b>{t.serverL}</b>
                <span>{store.serverLabel()}</span>
              </span>
            </li>
            <li className="row static">
              <span className="tx">
                <b>{t.keysL}</b>
                <span>{t.keysS}</span>
              </span>
            </li>
          </ul>
          <p className="about">{t.foot}</p>
        </div>
      </div>
    </Pane>
  );
}

/* ---------- tab bar ---------- */

function TabBar({ tab }: { tab: Tab }) {
  const store = useStore();
  const t = useCopy();
  const tabs: { id: Tab; icon: IconName; label: string }[] = [
    { id: "chat", icon: "bubble", label: t.chatTab },
    { id: "demo", icon: "play", label: t.demoTab },
    { id: "settings", icon: "sliders", label: t.setTab },
  ];

  return (
    <nav className="tabbar" aria-label="Sections">
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            className="tab"
            role="tab"
            id={`tab-${x.id}`}
            data-tab={x.id}
            aria-selected={tab === x.id}
            aria-controls={`pane-${x.id}`}
            onClick={() => store.setTab(x.id)}
          >
            <Icon name={x.icon} />
            <span className="tl">{x.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
