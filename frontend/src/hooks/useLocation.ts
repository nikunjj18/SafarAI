import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
type BatteryNavigator = Navigator & { getBattery?: () => Promise<{ level: number }> };
export function useLocation(userId: string, _report: (message: string) => void, simulator = false) {
  const [locationStatus, setLocationStatus] = useState('');
  const report = setLocationStatus;
  const [sharing, setSharing] = useState(() => {
    try {
      return localStorage.getItem('safarai.live-location.' + userId) !== 'no';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('safarai.live-location.' + userId, sharing ? 'yes' : 'no');
    } catch {}
  }, [sharing, userId]);
  useEffect(() => {
    if (!sharing) return;
    if (simulator) {
      let active = true,
        pending = false,
        ready = false;
      const sample = async () => {
        if (!active || !ready || pending) return;
        pending = true;
        try {
          await api('/simulator/location', 'POST', {});
          if (active) report('');
        } catch (e) {
          if (active) report((e as Error).message);
        } finally {
          pending = false;
        }
      };
      void api('/telemetry/start', 'POST')
        .then(() => {
          if (active) {
            ready = true;
            void sample();
          }
        })
        .catch((e) => {
          if (active) report(e.message);
        });
      const timer = setInterval(() => void sample(), 15000);
      const resume = () => {
        if (document.visibilityState === 'visible') void sample();
      };
      document.addEventListener('visibilitychange', resume);
      window.addEventListener('online', resume);
      return () => {
        active = false;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', resume);
        window.removeEventListener('online', resume);
      };
    }
    if (!navigator.geolocation) {
      report('This browser does not support location sharing.');
      setSharing(false);
      return;
    }
    let active = true,
      inFlight = false,
      ready = false,
      watch: number | undefined;
    async function sample(position?: GeolocationPosition) {
      if (inFlight || !active || !ready) return;
      if (!navigator.geolocation) {
        report('This browser does not support location sharing.');
        setSharing(false);
        return;
      }
      inFlight = true;
      const publish = async (position: GeolocationPosition) => {
        try {
          let battery: number | null = null;
          const batteryApi = (navigator as BatteryNavigator).getBattery;
          if (batteryApi) {
            try {
              battery = await Promise.race([
                batteryApi.call(navigator).then((b) => Math.round(b.level * 100)),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
              ]);
            } catch {}
          }
          if (!active) return;
          await api('/telemetry', 'POST', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            observedAt: new Date(position.timestamp).toISOString(),
            battery,
          });
          if (active) report('');
        } catch (e) {
          if (active) report((e as Error).message);
        } finally {
          inFlight = false;
        }
      };
      if (position) {
        await publish(position);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => void publish(p),
        (err) => {
          inFlight = false;
          if (!active) return;
          report(
            err.code === 1
              ? 'Location permission was denied. Allow location in your browser settings, then try again.'
              : '',
          );
          if (err.code === 1) setSharing(false);
        },
        { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 },
      );
    }
    void api('/telemetry/start', 'POST')
      .then(() => {
        if (active) {
          ready = true;
          watch = navigator.geolocation.watchPosition(
            (p) => void sample(p),
            () => void sample(),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
          );
          void sample();
        }
      })
      .catch((e) => {
        if (active) {
          report(e.message);
          setSharing(false);
        }
      });
    const timer = setInterval(() => void sample(), 15000);
    const resume = () => {
      if (document.visibilityState === 'visible') void sample();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      clearInterval(timer);
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [sharing, userId, report, simulator]);
  return { sharing, setSharing, locationStatus };
}
