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
import { MobileApiClient } from "../services/mobileApiClient";

/** Render a mobile objective form with request progress, output, and caught errors. */
export function AgentConsoleScreen() {
  const [objective, setObjective] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRunObjective = async () => {
    if (!objective.trim() || loading) return;

    setLoading(true);
    setOutput("Transmitting objective to RyanAI engine...");

    try {
      const res = await MobileApiClient.executeObjective(objective);
      setOutput(res.result);
    } catch (error: unknown) {
      setOutput(`Execution Failed: ${(error instanceof Error ? error.message : String(error))}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.innerContainer}
      >
        <Text style={styles.headerTitle}>RyanAI Mobile Console</Text>
        <Text style={styles.headerSubtitle}>Autonomous Reasoning & Ops Hub</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter task or evolution objective..."
          placeholderTextColor="#64748b"
          value={objective}
          onChangeText={setObjective}
          multiline
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRunObjective}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Execute Objective</Text>
          )}
        </TouchableOpacity>

        <ScrollView style={styles.outputContainer} contentContainerStyle={styles.outputContent}>
          <Text style={styles.outputLabel}>Execution Output:</Text>
          <Text style={styles.outputText}>{output || "Awaiting task execution..."}</Text>
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