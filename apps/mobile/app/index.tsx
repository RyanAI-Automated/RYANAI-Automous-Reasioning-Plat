import React,{useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,TextInput,View} from "react-native";
import {Redirect} from "expo-router";
import {useAuth} from "../src/useAuth";
export default function SignInRoute(){
 const {session,loading,signIn}=useAuth();const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 if(loading)return <View style={s.center}><ActivityIndicator color="#00F2FE"/></View>;
 if(session&&!session.user.is_anonymous)return <Redirect href="/reasoning"/>;
 async function submit(){if(busy||!email.trim()||!password)return;setBusy(true);setError("");try{await signIn(email,password);}catch(e){setError(e instanceof Error?e.message:"Sign-in failed.");}finally{setBusy(false);}}
 return <View style={s.root}><Text style={s.brand}>RYANAI</Text><Text style={s.title}>Welcome back, Sir</Text><Text style={s.sub}>Sign in securely to your reasoning workspace.</Text>
 <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor="#94a3b8" autoCapitalize="none" autoComplete="email" keyboardType="email-address"/>
 <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#94a3b8" secureTextEntry autoComplete="current-password"/>
 {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
 <Pressable disabled={busy||!email.trim()||!password} onPress={()=>void submit()} style={[s.button,(busy||!email.trim()||!password)&&{opacity:.5}]}>{busy?<ActivityIndicator color="#0D0E15"/>:<Text style={s.buttonText}>Sign in</Text>}</Pressable></View>;
}
const s=StyleSheet.create({root:{flex:1,justifyContent:"center",padding:24,gap:14,backgroundColor:"#0D0E15"},center:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:"#0D0E15"},brand:{color:"#00F2FE",letterSpacing:4,fontWeight:"800"},title:{color:"#F8FAFC",fontSize:28,fontWeight:"700"},sub:{color:"#aab3c5",marginBottom:12},input:{color:"#F8FAFC",backgroundColor:"#171925",borderColor:"#41475d",borderWidth:1,borderRadius:12,padding:15},error:{color:"#fca5a5"},button:{minHeight:50,alignItems:"center",justifyContent:"center",borderRadius:12,backgroundColor:"#00F2FE"},buttonText:{color:"#0D0E15",fontWeight:"800",fontSize:16}});
