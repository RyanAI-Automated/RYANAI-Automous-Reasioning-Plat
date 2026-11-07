import React from "react";
import {Pressable,StyleSheet,Text,View} from "react-native";
import {Redirect} from "expo-router";
import {AgentConsoleScreen} from "../../../src/screens/AgentConsoleScreen";
import {supabase} from "../src/lib/supabase";
import {useAuth} from "../src/useAuth";
export default function ReasoningRoute(){
 const {session,loading,signOut}=useAuth();
 if(loading)return <View style={s.center}><Text style={s.text}>Restoring secure session…</Text></View>;
 if(!session||session.user.is_anonymous)return <Redirect href="/"/>;
 return <View style={s.root}><View style={s.header}><Text style={s.heading}>RyanAI Mobile</Text><Pressable onPress={()=>void signOut()}><Text style={s.link}>Sign out</Text></Pressable></View>
 <AgentConsoleScreen getSession={async()=>{const {data,error}=await supabase.auth.getSession();if(error||!data.session)return null;return {accessToken:data.session.access_token,isAnonymous:data.session.user.is_anonymous};}}/></View>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:"#0D0E15"},header:{paddingHorizontal:18,paddingVertical:10,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},heading:{color:"#F8FAFC",fontSize:18,fontWeight:"700"},link:{color:"#00F2FE",fontWeight:"700",padding:8},center:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:"#0D0E15"},text:{color:"#F8FAFC"}});
