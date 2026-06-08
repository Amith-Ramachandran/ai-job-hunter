/**
 * Login page.
 *
 * Uses Google's pre-styled GoogleLogin button. On success we get a
 * `credential` (the Google ID token) — we POST it to /auth/google which
 * exchanges it for an HttpOnly session-cookie pair. The Google token is then
 * thrown away; we never persist it client-side.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GoogleLogin } from '@react-oauth/google';
import { Star } from 'lucide-react';
import { exchangeGoogleIdToken } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const { isAuthenticated } = useAuth();

  const exchangeMutation = useMutation({
    mutationFn: exchangeGoogleIdToken,
    onSuccess: (user) => {
      setUser(user);
      // Seed the /auth/me cache so the dashboard doesn't re-fetch immediately
      // after navigation.
      queryClient.setQueryData(['me'], user);
      navigate('/', { replace: true });
    },
    onError: (err) => {
      console.error('Google session exchange failed', err);
    },
  });

  // If they're already signed in, bounce to the dashboard.
  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Decorative star glow behind the card — soft amber radial fade,
          large blur. Subtle: signals the brand mark without literal stars
          scattered everywhere. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/15 blur-3xl"
      />
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-7 w-7 fill-brand text-brand" />
            <span className="text-3xl font-semibold tracking-tight">Dhruva</span>
          </div>
          <CardTitle className="sr-only">Dhruva</CardTitle>
          <CardDescription className="text-sm">
            Sign in to upload your CV and explore matched jobs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          <GoogleLogin
            onSuccess={(credentialResponse) => {
              const idToken = credentialResponse.credential;
              if (!idToken) return;
              exchangeMutation.mutate(idToken);
            }}
            onError={() => {
              console.error('Google sign-in failed');
            }}
          />
          <p className="text-center text-xs text-muted-foreground">
            We only read your name, email, and avatar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
