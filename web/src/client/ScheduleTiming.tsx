import { useState } from "react";
import { Button, Field, Input, Select } from "../lib";
import { clampInterval, readSimpleTiming, simpleTimingCron, weekDays } from "./scheduleTimingModel";
import type { IntervalUnit, ScheduleCron, SimpleTiming } from "./scheduleTimingModel";
import "./scheduleTiming.css";

const cronFields = [
  ["minute", "Minute", "0-59"], ["hour", "Hour", "0-23"],
  ["day_of_month", "Day of month", "1-31"], ["month", "Month", "1-12"],
  ["day_of_week", "Day of week", "0-6; Sunday is 0"],
] as const;

export function ScheduleTiming({ value, onChange }: { value: ScheduleCron; onChange: (cron: ScheduleCron) => void }) {
  const parsed = readSimpleTiming(value);
  const [advanced, setAdvanced] = useState(!parsed);
  // Retain the chosen unit at equivalent boundaries, such as 60 minutes / 1 hour.
  const [simple, setSimple] = useState<SimpleTiming>(parsed ?? { every: 1, unit: "hour", days: weekDays.map(day => day.value) });
  const update = (timing: SimpleTiming) => { setSimple(timing); onChange(simpleTimingCron(timing)); };
  const closeAdvanced = () => {
    const next = readSimpleTiming(value);
    if (next) setSimple(next);
    setAdvanced(false);
  };
  return <div className="schedule-timing">
    {!advanced && (parsed ? <>
      <fieldset className="schedule-days"><legend>Repeat on</legend>
        <div className="schedule-day-buttons">{weekDays.map(day => <button key={day.value} type="button"
          aria-label={day.name} aria-pressed={simple.days.includes(day.value)}
          onClick={() => update({ ...simple, days: simple.days.includes(day.value) ? simple.days.filter(d => d !== day.value) : [...simple.days, day.value] })}>
          {day.label}
        </button>)}</div>
      </fieldset>
      <div className="schedule-interval"><span aria-hidden="true">Every</span>
        <Input type="number" aria-label="Repeat interval" required min={1} max={simple.unit === "minute" ? 60 : 24} step={1}
          value={simple.every} onChange={event => update({ ...simple, every: clampInterval(event.target.valueAsNumber, simple.unit) })} />
        <Select aria-label="Interval unit" value={simple.unit} onChange={event => {
          const unit = event.target.value as IntervalUnit;
          update({ ...simple, unit, every: clampInterval(simple.every, unit) });
        }}><option value="minute">minutes</option><option value="hour">hours</option></Select>
      </div>
      {!simple.days.length && <p className="error" role="alert">Select at least one day.</p>}
      <p className="muted schedule-timing-hint">Uses the panel timezone. Minute intervals start at minute 0 of each hour; hour intervals start at midnight each day.
        {simple.unit === "minute" && simple.every > 1 && simple.every < 60 && 60 % simple.every !== 0 ? ` Every ${simple.every} minutes runs at minutes ${Array.from({ length: Math.ceil(60 / simple.every) }, (_, i) => i * simple.every).join(", ")} of each hour.` : ""}
        {simple.unit === "hour" && 24 % simple.every !== 0 ? ` Every ${simple.every} hours runs at hours ${Array.from({ length: Math.ceil(24 / simple.every) }, (_, i) => i * simple.every).join(", ")} each selected day.` : ""}
      </p>
    </> : <div className="schedule-custom"><p>This schedule uses custom cron rules. Open Advanced to edit them.</p>
      <Button type="button" variant="secondary" onClick={() => update({ every: 1, unit: "hour", days: weekDays.map(day => day.value) })}>Use a simple interval</Button>
    </div>)}
    <details className="schedule-advanced" open={advanced} onToggle={event => {
      if (event.currentTarget.open === advanced) return;
      if (event.currentTarget.open) setAdvanced(true); else closeAdvanced();
    }}>
      <summary>Advanced</summary>
      {advanced && <>
        <div className="form-grid">{cronFields.map(([key, label, range]) => <Field key={key} label={label} hint={`${range}; * means every value`}>
          <Input required value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} />
        </Field>)}</div>
        <div className="schedule-cheat-sheet"><h3>Cron cheat sheet</h3>
          <p>Order: minute / hour / day of month / month / day of week</p>
          <dl><dt><code>*</code></dt><dd>Every value</dd><dt><code>*/15</code></dt><dd>Every 15 values, starting at 0</dd>
            <dt><code>1,3,5</code></dt><dd>Only these values</dd><dt><code>1-5</code></dt><dd>A range, including both ends</dd></dl>
          <ul><li><code>*/15 * * * 1-5</code> Every 15 minutes, Monday to Friday</li>
            <li><code>0 */6 * * *</code> At 00:00, 06:00, 12:00 and 18:00 daily</li>
            <li><code>30 9 * * 1</code> Monday at 09:30</li></ul>
          <p className="muted">Uses the panel timezone. Intervals restart at each hour or day. Use * for day of month when selecting weekdays.</p>
        </div>
      </>}
    </details>
  </div>;
}
