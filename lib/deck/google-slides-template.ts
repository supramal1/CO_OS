type GoogleDriveCopyResponse = {
  id?: string;
  webViewLink?: string;
  error?: {
    message?: string;
  };
};

export function requireGoogleSlidesTemplateId(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("deck_template_google_slides_id_missing");
  return trimmed;
}

export async function copyDeckGoogleSlidesTemplate(input: {
  accessToken: string;
  templateFileId: string;
  title: string;
  folderId?: string | null;
  fetch?: typeof fetch;
}): Promise<{
  presentationId: string;
  webUrl: string;
  folderId: string | null;
}> {
  const templateFileId = requireGoogleSlidesTemplateId(input.templateFileId);
  const fetchImpl = input.fetch ?? fetch;
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      templateFileId,
    )}/copy`,
  );
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,webViewLink");

  const body: { name: string; parents?: string[] } = {
    name: input.title.trim() || "Untitled deck",
  };
  const folderId = input.folderId?.trim() || null;
  if (folderId) body.parents = [folderId];

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as GoogleDriveCopyResponse;

  if (!response.ok || !payload.id) {
    throw new Error(
      payload.error?.message ?? "deck_template_google_slides_copy_failed",
    );
  }

  return {
    presentationId: payload.id,
    webUrl:
      payload.webViewLink ??
      `https://docs.google.com/presentation/d/${payload.id}/edit`,
    folderId,
  };
}
