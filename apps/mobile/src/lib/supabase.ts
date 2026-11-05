import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
if (!url || !key) throw new Error("Configure the Supabase URL and publishable key in apps/mobile/.env.");
const parsed = new URL(url);
if (parsed.protocol !== "https:" && !["localhost","127.0.0.1"].includes(parsed.hostname)) {
  throw new Error("Supabase URL must use HTTPS outside local development.");
}

// SecureStore item sizes are bounded. Chunk larger serialized sessions; write
// the manifest last so interrupted writes are not exposed as complete sessions.
const CHUNK = 1800;
const COUNT = ".chunk-count";
const part = (key: string, index: number) => key + ".chunk." + index;
const storage = {
  async getItem(key: string) {
    const manifest = await SecureStore.getItemAsync(key + COUNT);
    if (manifest === null) return SecureStore.getItemAsync(key);
    const count = Number(manifest);
    if (!Number.isSafeInteger(count) || count < 1 || count > 64) return null;
    const values = await Promise.all(Array.from({length:count},(_,i)=>SecureStore.getItemAsync(part(key,i))));
    return values.some(value=>value===null) ? null : values.join("");
  },
  async setItem(key: string, value: string) {
    const previous = Number(await SecureStore.getItemAsync(key + COUNT) ?? "0");
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key,value);
      await SecureStore.deleteItemAsync(key + COUNT);
      if (previous > 0 && previous <= 64) await Promise.all(Array.from({length:previous},(_,i)=>SecureStore.deleteItemAsync(part(key,i))));
      return;
    }
    const chunks = value.match(new RegExp("[\\s\\S]{1," + CHUNK + "}","g")) ?? [];
    if (chunks.length > 64) throw new Error("Secure session exceeds the supported storage size.");
    await Promise.all(chunks.map((chunk,i)=>SecureStore.setItemAsync(part(key,i),chunk)));
    await SecureStore.setItemAsync(key + COUNT,String(chunks.length));
    await SecureStore.deleteItemAsync(key);
    if (previous > chunks.length && previous <= 64) await Promise.all(Array.from({length:previous-chunks.length},(_,i)=>SecureStore.deleteItemAsync(part(key,chunks.length+i))));
  },
  async removeItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(key + COUNT) ?? "0");
    await SecureStore.deleteItemAsync(key);
    await SecureStore.deleteItemAsync(key + COUNT);
    if (count > 0 && count <= 64) await Promise.all(Array.from({length:count},(_,i)=>SecureStore.deleteItemAsync(part(key,i))));
  }
};
export const supabase = createClient(url,key,{auth:{storage,autoRefreshToken:true,persistSession:true,detectSessionInUrl:false,flowType:"pkce"}});
