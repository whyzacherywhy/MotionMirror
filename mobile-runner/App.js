import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const apiBaseUrl = "https://coachlink-81u4.onrender.com";
const backgroundLocationTask = "motion-mirror-background-location";
const trackingStateKey = "motionMirror.runner.tracking";
const enableBackgroundLocation = false;
const metersToMiles = (meters) => meters / 1609.344;
const metersToFeet = (meters) => meters * 3.28084;
const splitDistanceMiles = 1;
const unusableAccuracyMeters = 180;
const maxRunningSpeedMetersPerSecond = 8.5;
const maxPossibleRunnerSpeedMetersPerSecond = 11.2;

function distanceMeters(a, b) {
  const earth = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

function usableSegmentMeters(a, b) {
  const meters = distanceMeters(a, b);
  if (!Number.isFinite(meters) || meters < 1) return 0;

  const seconds = Math.max(0, ((b?.at || 0) - (a?.at || 0)) / 1000);
  if (seconds <= 0) return 0;

  const accuracy = Math.max(Number(a.accuracy || 0), Number(b.accuracy || 0));
  const speed = meters / Math.max(1, seconds);
  const jitterFloorMeters = Math.min(5, Math.max(1, accuracy * 0.05));

  if (accuracy > unusableAccuracyMeters && meters < 20) return 0;
  if (meters < jitterFloorMeters) return 0;
  if (speed > maxPossibleRunnerSpeedMetersPerSecond && meters > 18) return 0;
  if (speed > maxRunningSpeedMetersPerSecond && meters > 25) return 0;

  return meters;
}

function pointFromLocation(location) {
  const { latitude, longitude, accuracy, altitude, speed, heading } = location.coords;
  return {
    lat: latitude,
    lng: longitude,
    accuracy,
    altitude,
    speed,
    heading,
    at: location.timestamp || Date.now(),
  };
}

function statsFor(points, elapsedSeconds) {
  let meters = 0;
  let gainMeters = 0;
  let lossMeters = 0;
  let splitStartAt = points[0]?.at || Date.now();
  let nextSplitBoundaryMeters = 1609.344;
  let lastCompletedSplitPace = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const segmentMeters = usableSegmentMeters(previous, current);
    const beforeMeters = meters;
    const afterMeters = meters + segmentMeters;

    while (afterMeters >= nextSplitBoundaryMeters && segmentMeters > 0) {
      const ratio = (nextSplitBoundaryMeters - beforeMeters) / segmentMeters;
      const segmentStart = previous.at || splitStartAt;
      const segmentEnd = current.at || segmentStart;
      const boundaryAt = segmentStart + (segmentEnd - segmentStart) * ratio;
      const completedSplitMinutes = Math.max(0.01, (boundaryAt - splitStartAt) / 60000);
      lastCompletedSplitPace = completedSplitMinutes / splitDistanceMiles;
      splitStartAt = boundaryAt;
      nextSplitBoundaryMeters += 1609.344;
    }

    if (segmentMeters > 0 && Number.isFinite(previous.altitude) && Number.isFinite(current.altitude)) {
      const delta = current.altitude - previous.altitude;
      if (delta > 0) gainMeters += delta;
      if (delta < 0) lossMeters += Math.abs(delta);
    }

    meters = afterMeters;
  }

  const miles = metersToMiles(meters);
  const elapsedMinutes = Math.max(0.01, elapsedSeconds / 60);
  const averagePace = miles > 0.02 ? elapsedMinutes / miles : 0;
  let currentSplitMiles = miles % splitDistanceMiles;
  if (miles > 0 && currentSplitMiles === 0) currentSplitMiles = splitDistanceMiles;

  const splitElapsedMinutes = Math.max(0.01, ((points.at(-1)?.at || Date.now()) - splitStartAt) / 60000);
  const rawSplitPace = currentSplitMiles > 0.02 ? splitElapsedMinutes / currentSplitMiles : 0;
  const referenceSplitPace = lastCompletedSplitPace || averagePace;
  const useReference =
    referenceSplitPace &&
    rawSplitPace &&
    (currentSplitMiles < 0.15 || splitElapsedMinutes * 60 < 45);

  return {
    miles,
    averagePace,
    currentSplitMiles,
    splitPace: useReference ? referenceSplitPace : rawSplitPace,
    elevationGainFeet: metersToFeet(gainMeters),
    elevationLossFeet: metersToFeet(lossMeters),
  };
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`;
  return `${minutes}:${remainingSeconds}`;
}

function formatPace(minutesPerMile) {
  if (!minutesPerMile || !Number.isFinite(minutesPerMile)) return "--";
  const minutes = Math.floor(minutesPerMile);
  const seconds = Math.round((minutesPerMile - minutes) * 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}/mi`;
}

function cleanSessionId(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("session") || url.searchParams.get("sessionId") || trimmed;
  } catch {
    const match = trimmed.match(/[?&]session(?:Id)?=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : trimmed;
  }
}

async function readTrackingState() {
  try {
    return JSON.parse(await AsyncStorage.getItem(trackingStateKey));
  } catch {
    return null;
  }
}

async function writeTrackingState(nextState) {
  await AsyncStorage.setItem(trackingStateKey, JSON.stringify(nextState));
}

async function postLocation(payload) {
  const response = await fetch(`${apiBaseUrl}/api/location`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Location upload failed");
}

async function postControl(path, sessionId) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw new Error("Control upload failed");
}

TaskManager.defineTask(backgroundLocationTask, async ({ data, error }) => {
  if (error) return;
  const trackingState = await readTrackingState();
  if (!trackingState?.isTracking || !trackingState?.sessionId) return;

  const locations = data?.locations || [];
  for (const location of locations) {
    await postLocation({
      sessionId: trackingState.sessionId,
      runnerName: trackingState.runnerName || "Runner",
      action: "track",
      mode: trackingState.mode || "free",
      ...pointFromLocation(location),
    }).catch(() => {});
  }
});

export default function App() {
  const [sessionId, setSessionId] = useState("demo");
  const [runnerName, setRunnerName] = useState("Runner");
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState("free");
  const [points, setPoints] = useState([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [trackingStartedAt, setTrackingStartedAt] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [pendingUploads, setPendingUploads] = useState([]);
  const [lastAccuracy, setLastAccuracy] = useState(null);
  const [tick, setTick] = useState(Date.now());
  const subscriptionRef = useRef(null);
  const tickRef = useRef(null);

  const elapsedSeconds = useMemo(() => {
    if (isTracking && trackingStartedAt) return (elapsedMs + Date.now() - trackingStartedAt) / 1000;
    return elapsedMs / 1000;
  }, [elapsedMs, isTracking, tick, trackingStartedAt]);

  const stats = useMemo(() => statsFor(points, elapsedSeconds), [points, elapsedSeconds]);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      if (isTracking) setTick(Date.now());
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [isTracking]);

  useEffect(() => {
    if (!pendingUploads.length) return;
    let cancelled = false;

    async function flush() {
      const next = [...pendingUploads];
      while (next.length && !cancelled) {
        const payload = next[0];
        try {
          await postLocation(payload);
          next.shift();
          setPendingUploads([...next]);
          setStatus("Tracking");
        } catch {
          setStatus("Syncing GPS");
          break;
        }
      }
    }

    flush();
    return () => {
      cancelled = true;
    };
  }, [pendingUploads]);

  async function queuePoint(point, action = "track") {
    const cleanSession = cleanSessionId(sessionId) || "demo";
    setPoints((current) => [...current, point].slice(-2500));
    setLastAccuracy(point.accuracy);
    setPendingUploads((current) => [
      ...current,
      {
        sessionId: cleanSession,
        runnerName: runnerName.trim() || "Runner",
        action,
        mode,
        ...point,
      },
    ].slice(-120));
  }

async function requestPermissions() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") throw new Error("Location permission is required.");

  if (!enableBackgroundLocation) {
    setStatus("Foreground GPS test");
    return false;
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") {
    setStatus("Foreground GPS only");
      return false;
    }

    return true;
  }

  async function startRun(nextMode = mode) {
    if (!consent) {
      Alert.alert("Consent needed", "Please agree to share live location for this session.");
      return;
    }

    try {
      setStatus("Locking GPS");
      const hasBackground = await requestPermissions();
      const action = points.length ? "resume" : "start";
      const startedAt = Date.now();
      setMode(nextMode);
      setTrackingStartedAt(startedAt);
      setIsTracking(true);
      await writeTrackingState({
        isTracking: true,
        sessionId: cleanSessionId(sessionId) || "demo",
        runnerName: runnerName.trim() || "Runner",
        mode: nextMode,
      });

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      await queuePoint(pointFromLocation(current), action);

      subscriptionRef.current?.remove?.();
      subscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 3,
        },
        (location) => queuePoint(pointFromLocation(location), "track"),
      );

      if (hasBackground) {
        const started = await Location.hasStartedLocationUpdatesAsync(backgroundLocationTask);
        if (!started) {
          await Location.startLocationUpdatesAsync(backgroundLocationTask, {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 3,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "Motion Mirror tracking",
              notificationBody: "Your coach can see your live run while this session is active.",
            },
          });
        }
      }

      setStatus("Tracking");
    } catch (error) {
      setIsTracking(false);
      setTrackingStartedAt(null);
      await writeTrackingState({ isTracking: false });
      Alert.alert("Could not start tracking", error.message);
      setStatus("GPS blocked");
    }
  }

  async function pauseRun() {
    if (!isTracking) return;
    subscriptionRef.current?.remove?.();
    subscriptionRef.current = null;
    setElapsedMs((value) => value + (trackingStartedAt ? Date.now() - trackingStartedAt : 0));
    setTrackingStartedAt(null);
    setIsTracking(false);
    await writeTrackingState({ isTracking: false });
    await Location.stopLocationUpdatesAsync(backgroundLocationTask).catch(() => {});
    await postControl("/api/pause", cleanSessionId(sessionId) || "demo").catch(() => {});
    setStatus("Paused");
  }

  async function stopRun() {
    Alert.alert("End session?", "Stop tracking and end this run?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes, stop",
        style: "destructive",
        onPress: async () => {
          subscriptionRef.current?.remove?.();
          subscriptionRef.current = null;
          setElapsedMs((value) => value + (trackingStartedAt ? Date.now() - trackingStartedAt : 0));
          setTrackingStartedAt(null);
          setIsTracking(false);
          await writeTrackingState({ isTracking: false });
          await Location.stopLocationUpdatesAsync(backgroundLocationTask).catch(() => {});
          await postControl("/api/stop", cleanSessionId(sessionId) || "demo").catch(() => {});
          setStatus("Stopped");
        },
      },
    ]);
  }

  function resetRun() {
    if (isTracking) return;
    setPoints([]);
    setElapsedMs(0);
    setTrackingStartedAt(null);
    setPendingUploads([]);
    setLastAccuracy(null);
    setStatus("Ready");
  }

  const canStart = consent && !isTracking;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.brand}>Motion Mirror</Text>
            <Text style={styles.subtitle}>Runner app test build</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Session</Text>
            <TextInput
              value={sessionId}
              onChangeText={setSessionId}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isTracking}
              placeholder="Paste runner link or session id"
              placeholderTextColor="#78818f"
              style={styles.input}
            />
            <Text style={styles.label}>Runner name</Text>
            <TextInput
              value={runnerName}
              onChangeText={setRunnerName}
              editable={!isTracking}
              placeholder="Runner"
              placeholderTextColor="#78818f"
              style={styles.input}
            />
          </View>

          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{mode === "track" ? "Track mode pace" : "Free run pace"}</Text>
            <Text style={styles.pace}>{formatPace(stats.splitPace)}</Text>
            <Text style={styles.progress}>{stats.currentSplitMiles.toFixed(2)}/1 mi current mile</Text>
          </View>

          <View style={styles.metrics}>
            <Metric label="Run time" value={formatDuration(elapsedSeconds)} />
            <Metric label="Distance" value={`${stats.miles.toFixed(2)} mi`} />
            <Metric label="Avg pace" value={formatPace(stats.averagePace)} />
            <Metric label="Elevation" value={`+${Math.round(stats.elevationGainFeet)} / -${Math.round(stats.elevationLossFeet)} ft`} />
          </View>

          <Pressable style={styles.consentRow} onPress={() => setConsent((value) => !value)}>
            <View style={[styles.checkbox, consent && styles.checkboxOn]} />
            <Text style={styles.consentText}>
              I agree to share my live location, route, distance, pace, time, and elevation with my coach for this session.
            </Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable disabled={!canStart} style={[styles.button, styles.startButton, !canStart && styles.disabled]} onPress={() => startRun("free")}>
              <Text style={styles.buttonText}>Start free run</Text>
            </Pressable>
            <Pressable disabled={!canStart} style={[styles.button, styles.trackButton, !canStart && styles.disabled]} onPress={() => startRun("track")}>
              <Text style={styles.buttonText}>Start track mode</Text>
            </Pressable>
            <View style={styles.actionRow}>
              <Pressable disabled={!isTracking} style={[styles.button, styles.pauseButton, !isTracking && styles.disabled]} onPress={pauseRun}>
                <Text style={styles.darkButtonText}>Pause</Text>
              </Pressable>
              <Pressable disabled={!points.length} style={[styles.button, styles.stopButton, !points.length && styles.disabled]} onPress={stopRun}>
                <Text style={styles.buttonText}>Stop</Text>
              </Pressable>
            </View>
            <Pressable disabled={isTracking || !points.length} style={[styles.resetButton, (isTracking || !points.length) && styles.disabled]} onPress={resetRun}>
              <Text style={styles.resetText}>Reset local screen</Text>
            </Pressable>
          </View>

          <View style={styles.statusCard}>
            <Text style={styles.status}>{status}</Text>
            <Text style={styles.statusDetail}>Queued uploads: {pendingUploads.length}</Text>
            <Text style={styles.statusDetail}>GPS accuracy: {Number.isFinite(lastAccuracy) ? `${Math.round(metersToFeet(lastAccuracy))} ft` : "--"}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#01081a",
  },
  screen: {
    flex: 1,
  },
  content: {
    padding: 18,
    gap: 14,
  },
  header: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  brand: {
    color: "#fbf5df",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0,
  },
  subtitle: {
    color: "#aeb7bf",
    marginTop: 4,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  card: {
    borderWidth: 1,
    borderColor: "rgba(251,245,223,0.18)",
    borderRadius: 12,
    padding: 14,
    gap: 8,
    backgroundColor: "rgba(251,245,223,0.04)",
  },
  label: {
    color: "#aeb7bf",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: "rgba(251,245,223,0.22)",
    borderRadius: 10,
    paddingHorizontal: 12,
    color: "#fbf5df",
    fontSize: 17,
    fontWeight: "800",
  },
  hero: {
    borderWidth: 1,
    borderColor: "rgba(251,245,223,0.18)",
    borderRadius: 12,
    padding: 18,
    backgroundColor: "rgba(251,245,223,0.05)",
  },
  heroLabel: {
    color: "#aeb7bf",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  pace: {
    color: "#fbf5df",
    marginTop: 8,
    fontSize: 58,
    lineHeight: 64,
    fontWeight: "900",
  },
  progress: {
    color: "#aeb7bf",
    fontSize: 15,
    fontWeight: "800",
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metric: {
    width: "48.7%",
    minHeight: 82,
    borderWidth: 1,
    borderColor: "rgba(251,245,223,0.18)",
    borderRadius: 12,
    padding: 12,
    justifyContent: "center",
    backgroundColor: "rgba(251,245,223,0.035)",
  },
  metricLabel: {
    color: "#aeb7bf",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#fbf5df",
    marginTop: 6,
    fontSize: 20,
    fontWeight: "900",
  },
  consentRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(251,245,223,0.18)",
    borderRadius: 12,
    padding: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fbf5df",
  },
  checkboxOn: {
    backgroundColor: "#8fe06b",
    borderColor: "#8fe06b",
  },
  consentText: {
    flex: 1,
    color: "#fbf5df",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  actions: {
    gap: 10,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    minHeight: 54,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  startButton: {
    backgroundColor: "#8fe06b",
  },
  trackButton: {
    backgroundColor: "#ff3b30",
  },
  pauseButton: {
    flex: 1,
    backgroundColor: "#ffd400",
  },
  stopButton: {
    flex: 1,
    backgroundColor: "#ff2d2d",
  },
  disabled: {
    opacity: 0.38,
  },
  buttonText: {
    color: "#01081a",
    fontSize: 17,
    fontWeight: "950",
  },
  darkButtonText: {
    color: "#01081a",
    fontSize: 17,
    fontWeight: "950",
  },
  resetButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "rgba(251,245,223,0.2)",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  resetText: {
    color: "#fbf5df",
    fontWeight: "900",
  },
  statusCard: {
    borderWidth: 1,
    borderColor: "rgba(251,245,223,0.18)",
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  status: {
    color: "#8fe06b",
    fontSize: 16,
    fontWeight: "950",
    textTransform: "uppercase",
  },
  statusDetail: {
    color: "#aeb7bf",
    fontWeight: "800",
  },
});
