import { toast } from "sonner";
import { InferRequestType, InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/hono";
import { readErrorMessage } from "@/lib/api-error";

type ResponseType = InferResponseType<typeof client.api.accounts["bulk-delete"]["$post"]>;
type RequestType = InferRequestType<typeof client.api.accounts["bulk-delete"]["$post"]>["json"];

export const useBulkDeleteAccounts = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    ResponseType,
    Error,
    RequestType
  >({
    mutationFn: async (json) => {
      const response = await client.api.accounts["bulk-delete"]["$post"]({ json });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to delete accounts"));
      }

      return await response.json();
    },
    onSuccess: () => {
      toast.success("Accounts deleted");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      // Deleting an account cascades to its transactions.
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return mutation;
};
