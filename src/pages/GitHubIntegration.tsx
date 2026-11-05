import GithubModal from '@/components/GithubModal';

export default function GitHubIntegrationPage() {
  return <GithubModal open presentation="page" onClose={() => { window.location.hash = '/dashboard'; }} />;
}
