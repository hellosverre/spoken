"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { SCENARIOS } from "@/lib/scenarios";
import type { Tab, ThreadItem } from "@/lib/store";
import { cx, useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Composer } from "./Composer";
import { Icon, Wordmark, type IconName } from "./Icon";
import { Presets } from "./Presets";
import { Profile } from "./Profile";

export function Home({ on }: { on: boolean }) {
  const store = useStore();
  const t = useCopy();
  const threaded = useSpoken((s) => s.threaded);
  const tab = useSpoken((s) => s.tab);

  return (
    <section className={cx("screen", on && "on", threaded && "threaded")} id="home" aria-label="Home">
      <header className="topbar pad">
        <Wordmark />
        {threaded && tab === "chat" && (
          <button className="iconbtn newchat" aria-label={t.newChat} onClick={() => store.newChat()}>
            <Icon name="plus" />
          </button>
        )}
      </header>
      <div className="panes">
        <Pane id="home" active={tab === "home"}>
          <Presets />
        </Pane>
        <ChatPane active={tab === "chat"} />
        <Pane id="settings" active={tab === "settings"}>
          <Profile />
        </Pane>
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
          placeholder={t.ph}
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
    case "plan":
      return <PlanCard item={item} />;
  }
}

function PlanCard({ item }: { item: Extract<ThreadItem, { kind: "plan" }> }) {
  const store = useStore();
  const t = useCopy();
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const sc = SCENARIOS[item.scenario];
  const L = sc[lang];

  return (
    <div className="plan">
      <div className="who">
        <span className="av">{sc.init}</span>
        <div>
          <b>{L.contact}</b>
          <span>{sc.number}</span>
        </div>
      </div>
      <div>
        <p className="field-l">{t.planGoal}</p>
        <p>{L.goal}</p>
      </div>
      <div>
        <p className="field-l">{t.planAsk}</p>
        <div className="checks">
          {L.checks.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      </div>
      <div>
        <p className="field-l">{t.planOpen}</p>
        <div className="quote">“{L.opening}”</div>
      </div>
      <div className="acts">
        <button className={cx("btn primary block tall", item.pressed && "pressed")} onClick={() => store.startCall()}>
          <Icon name="phone" />
          {t.start}
        </button>
        <div className="acts-row">
          <button className="btn ghost" onClick={() => store.editPlan(item.request)}>
            <Icon name="pencil" />
            {t.edit}
          </button>
          <button className="btn ghost" onClick={() => store.newChat()}>
            {m.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- tab bar ---------- */

function TabBar({ tab }: { tab: Tab }) {
  const store = useStore();
  const t = useCopy();
  const m = useAppCopy();
  const tabs: { id: Tab; icon: IconName; label: string }[] = [
    { id: "home", icon: "home", label: m.homeTab },
    { id: "chat", icon: "bubble", label: t.chatTab },
    { id: "settings", icon: "person", label: m.profileTab },
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
