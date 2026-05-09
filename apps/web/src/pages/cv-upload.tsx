/**
 * CV upload + history.
 *
 * Uses react-hook-form for the upload form (even though it has just one
 * field) so the pattern is consistent across the app and ready to grow.
 * Validation lives in a Zod schema — the hook-form/zod resolver applies it.
 *
 * The mutation invalidates the `cvs` query key on success so the history
 * list refreshes automatically — this is the canonical TanStack Query
 * pattern for keeping local state coherent after a write.
 */
import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { listCvs, uploadCv, type Cv } from '@/lib/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatBytes, formatRelativeTime } from '@/lib/utils';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
];

const uploadSchema = z.object({
  file: z
    .custom<FileList>((v) => v instanceof FileList && v.length > 0, 'Pick a file')
    .refine((v) => ACCEPTED_TYPES.includes(v[0]?.type), 'Unsupported file type')
    .refine((v) => v[0]?.size <= 5 * 1024 * 1024, 'Max 5MB'),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

export function CvUploadPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cvsQuery = useQuery({ queryKey: ['cvs'], queryFn: listCvs });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UploadFormValues>({ resolver: zodResolver(uploadSchema) });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadCv(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cvs'] });
      reset();
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const onSubmit = handleSubmit((values) => {
    const file = values.file[0];
    uploadMutation.mutate(file);
  });

  // Avoid using `register('file').ref` directly because we also keep a local
  // ref for resetting the input value after a successful upload.
  const fileRegister = register('file');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your CV</h1>
        <p className="text-sm text-muted-foreground">
          Upload a CV. Each upload becomes a new version — old ones are kept
          so historical match scores remain reproducible.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>PDF, DOCX, DOC, or TXT. Max 5 MB.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              {...fileRegister}
              ref={(el) => {
                fileRegister.ref(el);
                fileInputRef.current = el;
              }}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-secondary/80"
            />
            {errors.file && (
              <p className="text-sm text-destructive">{errors.file.message as string}</p>
            )}
            {uploadMutation.isError && (
              <p className="text-sm text-destructive">
                Upload failed. Please try again.
              </p>
            )}
            <Button type="submit" disabled={isSubmitting || uploadMutation.isPending}>
              {uploadMutation.isPending ? 'Uploading…' : 'Upload CV'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>All your uploaded CVs.</CardDescription>
        </CardHeader>
        <CardContent>
          {cvsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : cvsQuery.data && cvsQuery.data.length > 0 ? (
            <ul className="divide-y divide-border">
              {cvsQuery.data.map((cv: Cv) => (
                <li key={cv.id} className="flex items-center justify-between py-3 text-sm">
                  <div className="space-y-0.5">
                    <p className="font-medium">{cv.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      v{cv.version} · {formatBytes(cv.sizeBytes)} ·{' '}
                      {formatRelativeTime(cv.uploadedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No CVs uploaded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
