import { useSettingsState } from '../../hooks/useSettings';

/**
 * The one switch for counting bodyweight in volume, next to the weight it
 * would use. It lives here rather than in Settings because the number it
 * changes — and the weigh-in it reads — are both on this screen.
 */
export function BodyweightVolumeToggle() {
  const [settings, setSettings] = useSettingsState();
  const on = settings.countBodyweight === true;

  return (
    <div className="flex items-start gap-3">
      <label htmlFor="count-bodyweight" className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">Count bodyweight in volume</span>
        <span className="block text-xs text-muted">
          Count bodyweight × reps in volume for bodyweight exercises. Uses your latest
          entry.
        </span>
      </label>
      <button
        id="count-bodyweight"
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => void setSettings({ countBodyweight: !on })}
        className={[
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors',
          on ? 'bg-accent' : 'bg-surface-2 border border-border',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'absolute top-1 h-5 w-5 rounded-full bg-bg transition-all',
            on ? 'left-6' : 'left-1',
          ].join(' ')}
        />
      </button>
    </div>
  );
}

export default BodyweightVolumeToggle;
