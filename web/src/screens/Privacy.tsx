import { Screen, Section } from "../components/ui.tsx";
import { useT } from "../i18n/useT.ts";
import { href } from "../lib/router.tsx";

export function Privacy() {
  const { d } = useT();
  return (
    <Screen kind="privacy" title={d.privacy.title} back={href({ name: "settings" })}>
      <div className="sp-prose">
        {d.privacy.body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <Section title={d.privacy.processors} kind="processors">
        <ul className="sp-processors">
          <li>{d.privacy.processorList.elevenlabs}</li>
          <li>{d.privacy.processorList.telnyx}</li>
          <li>{d.privacy.processorList.llm}</li>
        </ul>
      </Section>
    </Screen>
  );
}
