export type IntervalUnit = "minute" | "hour";
export type ScheduleCron = { minute: string; hour: string; day_of_month: string; month: string; day_of_week: string };
export type SimpleTiming = { every: number; unit: IntervalUnit; days: number[]; startTime?: string };
export const weekDays = [
  { value: 1, label: "Mon", name: "Monday" },
  { value: 2, label: "Tue", name: "Tuesday" },
  { value: 3, label: "Wed", name: "Wednesday" },
  { value: 4, label: "Thu", name: "Thursday" },
  { value: 5, label: "Fri", name: "Friday" },
  { value: 6, label: "Sat", name: "Saturday" },
  { value: 0, label: "Sun", name: "Sunday" },
];
export function clampInterval(value: number, unit: IntervalUnit): number {
  return Math.min(unit === "minute" ? 60 : 24, Math.max(1, Number.isFinite(value) ? Math.trunc(value) : 1));
}
export function simpleTimingCron(timing: SimpleTiming): ScheduleCron {
  const every = clampInterval(timing.every, timing.unit);
  const days = weekDays.filter(day => timing.days.includes(day.value)).map(day => day.value);
  const step = every === 1 ? "*" : `*/${every}`;
  const [startHour,startMinute]=/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.startTime??'')?timing.startTime!.split(':').map(Number):[0,0];
  const hours=Array.from({length:Math.ceil(24/every)},(_,index)=>(startHour+index*every)%24);
  return {
    minute: timing.unit === "hour" ? String(startMinute) : every === 60 ? "0" : step,
    hour: timing.unit === "minute" ? "*" : every === 24 ? String(startHour) : startHour===0 ? step : hours.join(','),
    day_of_month: "*", month: "*", day_of_week: days.length === 7 ? "*" : days.join(","),
  };
}
export function readSimpleTiming(cron: ScheduleCron): SimpleTiming | null {
  if (cron.day_of_month !== "*" || cron.month !== "*") return null;
  const days = cron.day_of_week === "*" ? weekDays.map(day => day.value)
    : cron.day_of_week === "" ? [] : cron.day_of_week.split(",").map(Number);
  if (cron.day_of_week !== "*" && cron.day_of_week !== "" && !/^[0-6](,[0-6])*$/.test(cron.day_of_week)) return null;
  if (new Set(days).size !== days.length) return null;
  const step = (value: string, max: number) => {
    if (value === "*") return 1;
    const match = /^\*\/([1-9]\d*)$/.exec(value);
    return match && Number(match[1]) <= max ? Number(match[1]) : null;
  };
  if (cron.hour === "*") {
    if (/^(?:[0-9]|[1-5][0-9])$/.test(cron.minute)) return { every: 1, unit: "hour", days, startTime:`00:${cron.minute.padStart(2,'0')}` };
    const every = step(cron.minute, 59);
    if (every) return { every, unit: "minute", days };
  }
  if (/^(?:[0-9]|[1-5][0-9])$/.test(cron.minute)) {
    const time=(hour:number)=>`${String(hour).padStart(2,'0')}:${cron.minute.padStart(2,'0')}`;
    if (/^(?:[0-9]|1[0-9]|2[0-3])$/.test(cron.hour)) return { every: 24, unit: "hour", days, startTime:time(Number(cron.hour)) };
    const every = step(cron.hour, 23);
    if (every) return { every, unit: "hour", days, startTime:time(0) };
    if (/^(?:[0-9]|1[0-9]|2[0-3])(?:,(?:[0-9]|1[0-9]|2[0-3]))+$/.test(cron.hour)) {
      const hours=cron.hour.split(',').map(Number);
      const interval=(hours[1]-hours[0]+24)%24;
      if(interval&&hours.length===Math.ceil(24/interval)&&hours.every((hour,index)=>hour===(hours[0]+index*interval)%24))return {every:interval,unit:'hour',days,startTime:time(hours[0])};
    }
  }
  return null;
}
