import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

type BatteryNavigator = Navigator & { getBattery?: () => Promise<{ level: number }> };
export function useLocation(userId: string, _report: (message: string) => void, simulator = false) {
  const [locationStatus, report] = useState('Requesting location sharing…');
  const [restart, setRestart] = useState(0);
  const [sharing, setSharing] = useState(() => {
    try {
      return localStorage.getItem('safarai.live-location.' + userId) !== 'no';
    } catch {
      return true;
    }
  });
  const requestLocation = () => {
    // Request permission directly from the click, before any network round trip.
    if (!simulator && navigator.geolocation)
      navigator.geolocation.getCurrentPosition(
        () => report('Location allowed. Updating your group…'),
        (error) =>
          report(
            error.code === 1
              ? 'Location is blocked. Open this site’s browser permissions, allow Location, then try again.'
              : 'Waiting for a GPS fix. Your last recorded position remains visible.',
          ),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    setSharing(true);
    setRestart((v) => v + 1);
  };
  useEffect(() => {
    try {
      localStorage.setItem('safarai.live-location.' + userId, sharing ? 'yes' : 'no');
    } catch {}
  }, [sharing, userId]);
  useEffect(() => {
    if (!sharing) {
      report('Location sharing is paused.');
      return;
    }
    if (!simulator && !navigator.geolocation) {
      report('This browser does not support location sharing.');
      return;
    }
    let active = true,
      ready = false,
      starting = false,
      pending = false;
    let watch: number | undefined;
    let acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let lastAccurateAt = 0;
    report(
      simulator
        ? 'Connecting to Nokia simulator…'
        : 'Allow location access to appear on your group map.',
    );
    const fail = (message: string) => {
      if (active) report(message);
    };
    async function publish(position: GeolocationPosition, token: number) {
      if (!active || token !== generation) return;
      clearTimeout(acquisitionTimer);
      try {
        // A coarse fallback must not immediately replace a recent precise fix.
        if (position.coords.accuracy > 150 && Date.now() - lastAccurateAt < 60000) return;
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
        if (!active || token !== generation) return;
        await api('/telemetry', 'POST', {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          observedAt: new Date(position.timestamp).toISOString(),
          battery,
        });
        if (position.coords.accuracy <= 150) lastAccurateAt = position.timestamp;
        if (active)
          report(
            position.coords.accuracy > 150
              ? 'Location received; waiting for a more accurate fix to assess the 150 m boundary.'
              : '',
          );
      } catch (e) {
        fail((e as Error).message + ' Retrying automatically.');
      } finally {
        if (token === generation) pending = false;
      }
    }
    function acquire(token: number, highAccuracy = true) {
      navigator.geolocation.getCurrentPosition(
        (p) => void publish(p, token),
        (error) => {
          if (!active || token !== generation) return;
          if (error.code !== 1 && highAccuracy) {
            acquire(token, false);
            return;
          }
          clearTimeout(acquisitionTimer);
          pending = false;
          if (error.code === 1) {
            fail('Allow location in your browser site settings, then tap Share my location.');
          } else fail('Waiting for a fresh location. Retrying automatically.');
        },
        {
          enableHighAccuracy: highAccuracy,
          maximumAge: 5000,
          timeout: highAccuracy ? 15000 : 10000,
        },
      );
    }
    async function sample(position?: GeolocationPosition) {
      if (!active || !ready || pending) return;
      pending = true;
      const token = ++generation;
      if (simulator) {
        try {
          await api('/simulator/location', 'POST', {});
          if (active) report('');
        } catch (e) {
          fail((e as Error).message + ' Retrying automatically.');
        } finally {
          pending = false;
        }
      } else if (position) await publish(position, token);
      else {
        // Recover even if a suspended browser never invokes the GPS callbacks.
        acquisitionTimer = setTimeout(() => {
          if (active && token === generation) {
            generation++;
            pending = false;
            fail('Waiting for a fresh location. Retrying automatically.');
          }
        }, 30000);
        acquire(token);
      }
    }
    async function tick() {
      if (!active) return;
      if (!ready) {
        if (starting) return;
        starting = true;
        try {
          await api('/telemetry/start', 'POST');
          if (!active) return;
          ready = true;
          if (!simulator)
            watch = navigator.geolocation.watchPosition(
              (p) => void sample(p),
              () => void sample(),
              { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
            );
        } catch (e) {
          fail((e as Error).message + ' Retrying automatically.');
        } finally {
          starting = false;
        }
      }
      if (ready) void sample();
    }
    void tick();
    const timer = setInterval(() => void tick(), 15000);
    const resume = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      generation++;
      clearInterval(timer);
      clearTimeout(acquisitionTimer);
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [sharing, userId, simulator, restart]);
  return { sharing, setSharing, locationStatus, requestLocation };
}
