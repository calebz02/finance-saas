import { toast } from "sonner";
import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/hono";
import { readErrorMessage } from "@/lib/api-error";

type ResponseType = InferResponseType<typeof client.api.categories["bulk-delete"]["$post"]>;
type RequestType = InferRequestType<typeof client.api.categories["bulk-delete"]["$post"]>["json"];

export const useBulkDeleteCategories = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    ResponseType,
    Error,
    RequestType
  >({
    mutationFn: async (json) => {
      const response = await client.api.categories["bulk-delete"]["$post"]({ json });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to delete categories"));
      }

      return await response.json();
    },
    onSuccess: () => {
      toast.success("Categories deleted");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      // Deleted categories are SET NULL on transactions, which changes the list's category column.
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return mutation;
};
