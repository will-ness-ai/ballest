// /prefabs/new: uploading a Prefab (components/prefabs/UploadForm). Kept out of search
// results; the form asks /api/prefabs whether the reader may upload.
import type { Metadata } from "next";

import { Shell } from "../../../components/Shell";
import { UploadForm } from "../../../components/prefabs/UploadForm";

export const metadata: Metadata = {
  title: "Upload a prefab",
  robots: { index: false },
};

export default function Page() {
  return (
    <Shell view="prefabs">
      <UploadForm />
    </Shell>
  );
}
