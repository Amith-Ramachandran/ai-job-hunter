/**
 * Login page.
 *
 * Uses Google's pre-styled GoogleLogin button. On success, we get a
 * `credential` (the ID token). We store it + decode the basic profile so
 * the UI has something to show before the first /auth/me round-trip.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { useAuthStore } from '@/stores/auth.store';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface GoogleIdTokenClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signIn);
  const { isAuthenticated } = useAuth();

  // If they're already signed in, bounce to the dashboard.
  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">AI Career Copilot</CardTitle>
          <CardDescription>Sign in to upload your CV and explore matched jobs.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          <GoogleLogin
            onSuccess={(credentialResponse) => {
              const idToken = credentialResponse.credential;
              if (!idToken) return;
              const claims = jwtDecode<GoogleIdTokenClaims>(idToken);
              signIn(idToken, {
                id: '',                          // backend assigns; refreshed by /auth/me
                googleSub: claims.sub,
                email: claims.email,
                name: claims.name ?? null,
                picture: claims.picture ?? null,
              });
              navigate('/', { replace: true });
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
