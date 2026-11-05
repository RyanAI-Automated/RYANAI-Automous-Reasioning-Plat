import React,{createContext,useContext,useEffect,useMemo,useState} from "react";
import type {Session} from "@supabase/supabase-js";
import {supabase} from "./lib/supabase";
type AuthValue={session:Session|null;loading:boolean;signIn:(email:string,password:string)=>Promise<void>;signOut:()=>Promise<void>};
const AuthContext=createContext<AuthValue|null>(null);
export function AuthProvider({children}:React.PropsWithChildren){
 const [session,setSession]=useState<Session|null>(null);const [loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;supabase.auth.getSession().then(({data,error})=>{if(active){setSession(error?null:data.session);setLoading(false);}}).catch(()=>{if(active){setSession(null);setLoading(false);}});
 const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{if(active)setSession(next);});
 return()=>{active=false;subscription.unsubscribe();};},[]);
 const value=useMemo<AuthValue>(()=>({session,loading,
  async signIn(email,password){const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;},
  async signOut(){const {error}=await supabase.auth.signOut();if(error)throw error;}
 }),[session,loading]);
 return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error("useAuth must be used within AuthProvider.");return value;}
