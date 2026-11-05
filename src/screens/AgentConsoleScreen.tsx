// src/screens/AgentConsoleScreen.tsx
import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  executeAuthenticatedMobileObjective,
  type MobileSessionReader,
} from "../services/mobileApiClient";

export interface AgentConsoleScreenProps {
  /** Read the current verified Supabase session from the host mobile app. */
  getSession: MobileSessionReader;
}

/**
 * Render the mobile reasoning console. Authentication is supplied by the
 * host app so this screen never owns, stores, or invents a session token.
 */
export function AgentConsoleScreen({ getSession }: AgentConsoleScreenProps) {
  const [objective, setObjective] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRunObjective = async () => {
    const normalizedObjective = objective.trim();
    if (!normalizedObjective || loading) return;

    setLoading(true);
    setOutput("Verifying your RyanAI session…");

    try {
      const response = await executeAuthenticatedMobileObjective(
        normalizedObjective,
        getSession,
      );
      setOutput(response.result);
    } catch (error: unknown) {
      setOutput(
        `Request failed: ${error instanceof Error ? error.message : "Please try again."}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const submitDisabled = loading || !objective.trim();

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.innerContainer}
      >
        <Text style={styles.headerTitle}>RyanAI Mobile Reasoning</Text>
        <Text style={styles.headerSubtitle}>
          Authenticated reasoning through your RyanAI account
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Enter a reasoning question or task…"
          placeholderTextColor="#64748b"
          value={objective}
          onChangeText={setObjective}
          multiline
          maxLength={20000}
          editable={!loading}
          accessibilityLabel="Reasoning objective"
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.button, submitDisabled && styles.buttonDisabled]}
          onPress={() => void handleRunObjective()}
          disabled={submitDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: submitDisabled, busy: loading }}
          accessibilityLabel="Run authenticated reasoning request"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Run reasoning</Text>
          )}
        </TouchableOpacity>

        <ScrollView
          style={styles.outputContainer}
          contentContainerStyle={styles.outputContent}
          accessibilityLabel="Reasoning response"
        >
          <Text style={styles.outputLabel}>Reasoning output</Text>
          <Text accessibilityLiveRegion="polite" style={styles.outputText}>
            {output || "Sign in with your RyanAI account to submit a reasoning request."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  innerContainer: {
    flex: 1,
    padding: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#f8fafc",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#94a3b8",
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 16,
    color: "#f8fafc",
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#4f46e5",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  outputContainer: {
    flex: 1,
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
  },
  outputContent: {
    paddingBottom: 20,
  },
  outputLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  outputText: {
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    color: "#38bdf8",
    fontSize: 14,
    lineHeight: 20,
  },
});
