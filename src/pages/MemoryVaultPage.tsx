import MemoryVault from '@/components/MemoryVault';

export default function MemoryVaultPage({ userId }: { userId: string }) {
  return <MemoryVault open userId={userId} presentation="page" onClose={() => { window.location.hash = '/workspace'; }} />;
}
