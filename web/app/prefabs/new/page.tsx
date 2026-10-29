// /prefabs/new: uploading a Prefab (components/prefabs/UploadForm). Kept out of search
// results; the form asks /api/prefabs whether the reader may upload.
import type { Metadata } from "next";

import { PageHead } from "../../../components/PageHead";
import { Shell } from "../../../components/Shell";
import { UploadForm } from "../../../components/prefabs/UploadForm";
import { newPrefabHref } from "../../../lib/routes";

export const metadata: Metadata = {
  title: "Upload a prefab",
  robots: { index: false },
};

export default function Page() {
  return (
    <Shell view="prefabs">
      <PageHead path={newPrefabHref()} title="Upload a prefab" />
      <UploadForm />
    </Shell>
  );
}
