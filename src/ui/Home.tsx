import { t } from '../i18n';
import { HomeCellAnimation } from './HomeCellAnimation';

export function Home() {
  return (
    <section className="home" data-testid="home">
      <div className="home-intro">
        <p className="home-eyebrow">{t.home.eyebrow}</p>
        <h1>{t.home.title}</h1>
        <p className="home-description">{t.home.description}</p>
        <div className="home-actions">
          <a className="home-primary" href="#/play" data-testid="home-play">{t.app.modes.play}<span aria-hidden="true">↗</span></a>
          <a className="home-secondary" href="#/watch" data-testid="home-watch">{t.app.modes.watch}</a>
        </div>
      </div>
      <HomeCellAnimation />
    </section>
  );
}
