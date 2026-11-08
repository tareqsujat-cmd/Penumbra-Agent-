/** The opening story, told over the Moon. It fades once you touch the globe (or close it). */
import { goTo } from "../../app/Header";

export function ExploreHero({ onBegin, onClose, leaving = false }: { onBegin: () => void; onClose: () => void; leaving?: boolean }) {
  return (
    <section className={`pn-hero${leaving ? " is-leaving" : ""}`} aria-label="About Penumbra" aria-hidden={leaving || undefined}>
      <button className="pn-hero__close" onClick={onClose} aria-label="Hide introduction">
        ×
      </button>
      <div className="pn-kicker">01 · Explore · Lunar south pole</div>
      <h1 className="pn-display pn-glow">
        Know your odds of light
        <br />
        before you land
      </h1>
      <p className="pn-hero__lede">
        Near the lunar south pole the Sun skims the horizon. Ridges a few hundred metres away decide who has light, and landers rarely touch down exactly where
        they aim.
      </p>
      <ol className="pn-hero__chapters">
        <li>
          <span>01</span>
          <b>Real terrain</b> NASA 5 m and LOLA elevation, 300 km of horizon
        </li>
        <li>
          <span>02</span>
          <b>Real geometry</b> JPL SPICE Sun, Earth and Deep Space Network
        </li>
        <li>
          <span>03</span>
          <b>Real uncertainty</b> 2,000 possible touchdowns, one robust aim
        </li>
      </ol>
      <div className="pn-hero__cta">
        <button className="ids-btn ids-btn--primary ids-btn--lg" onClick={onBegin}>
          Begin landing analysis
        </button>
        <button className="ids-btn ids-btn--lg pn-btn-line" onClick={() => goTo("about")}>
          How it works
        </button>
      </div>
      <p className="pn-hero__hint">Drag the Moon to spin it · scroll to zoom · click anywhere to inspect it</p>
    </section>
  );
}
