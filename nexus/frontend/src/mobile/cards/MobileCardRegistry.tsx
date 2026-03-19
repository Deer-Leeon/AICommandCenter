import type { WidgetType } from '../../types';
import { MobileCalendarCard } from './MobileCalendarCard';
import { MobileWeatherCard } from './MobileWeatherCard';
import { MobileTodoCard } from './MobileTodoCard';
import { MobileNewsCard } from './MobileNewsCard';
import { MobileStocksCard } from './MobileStocksCard';
import { MobilePomodoroCard } from './MobilePomodoroCard';
import { MobileNotesCard } from './MobileNotesCard';
import { MobileLofiCard } from './MobileLofiCard';
import { MobileFallbackCard } from './MobileFallbackCard';
import { WordleWidget } from '../../components/widgets/WordleWidget';
import { MobileSharedChessCard } from './MobileSharedChessCard';
import { F1Widget } from '../../components/widgets/F1Widget';
import { SpotifyWidget } from '../../components/widgets/SpotifyWidget';

export function MobileCardContent({ widgetType }: { widgetType: WidgetType }) {
  switch (widgetType) {
    case 'calendar':     return <MobileCalendarCard />;
    case 'weather':      return <MobileWeatherCard />;
    case 'todo':         return <MobileTodoCard />;
    case 'news':         return <MobileNewsCard />;
    case 'stocks':       return <MobileStocksCard />;
    case 'pomodoro':     return <MobilePomodoroCard />;
    case 'notes':        return <MobileNotesCard />;
    case 'lofi':         return <MobileLofiCard />;
    // These widgets use ResizeObserver internally and render correctly at any size.
    case 'spotify':      return <SpotifyWidget onClose={() => {}} />;
    case 'wordle':       return <WordleWidget onClose={() => {}} />;
    case 'f1':           return <F1Widget onClose={() => {}} />;
    case 'shared_chess': return <MobileSharedChessCard />;
    default:             return <MobileFallbackCard widgetType={widgetType} />;
  }
}
