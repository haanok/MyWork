import { useEffect, useState } from 'react';
import { today } from './dates';

/** Keep an open day plan current across midnight and after sleep. */
export function useToday() {
  const [day, setDay] = useState(today);
  useEffect(() => {
    const update = () => setDay(today());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return day;
}
