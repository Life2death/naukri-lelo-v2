import { useState } from "react";
import { TYPE_PROVIDER } from "@/types";
import { AI_PROVIDERS } from "@/config";
import { useApp } from "@/contexts";
import {
  getCustomAiProviders,
  addCustomAiProvider,
  updateCustomAiProvider,
  removeCustomAiProvider,
  validateCurl,
} from "@/lib";

export function useCustomAiProviders() {
  const { loadData } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [formData, setFormData] = useState<TYPE_PROVIDER>({
    id: "",
    streaming: false,
    responseContentPath: "",
    isCustom: true,
    curl: "",
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleEdit = (providerId: string) => {
    const customProviders = getCustomAiProviders();
    const provider = customProviders.find((p) => p.id === providerId);
    if (!provider) return;

    setFormData({
      ...provider,
    });
    setEditingProvider(providerId);
    // Open, don't toggle. Toggling meant clicking "Edit" on provider B while
    // already editing provider A *closed* the form, even though the form had
    // just been switched to B.
    setShowForm(true);
    setErrors({});
  };

  const handleAutoFill = (providerId: string) => {
    const provider = AI_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    setFormData({
      ...provider,
      curl: provider.curl,
    });

    setErrors({});
  };

  const handleDelete = (providerId: string) => {
    setDeleteConfirm(providerId);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      const success = removeCustomAiProvider(deleteConfirm);
      if (success) {
        setDeleteConfirm(null);
        loadData(); // Refresh data
      } else {
        // Previously this branch did nothing at all: the dialog just sat open
        // with no explanation and the user assumed it had worked.
        setErrors({ general: "Failed to delete provider. Please try again." });
        setDeleteConfirm(null);
      }
    } catch (error) {
      console.error("Error deleting custom provider:", error);
      setErrors({ general: "Failed to delete provider. Please try again." });
      setDeleteConfirm(null);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm(null);
  };

  const handleSave = async () => {
    // Validate form
    const newErrors: { [key: string]: string } = {};

    if (!formData.curl.trim()) {
      newErrors.curl = "Curl command is required";
    } else {
      const validation = validateCurl(formData.curl, ["TEXT"]);
      if (!validation.isValid) {
        newErrors.curl = validation.message || "";
      }
    }

    if (!formData.responseContentPath?.trim()) {
      newErrors.responseContentPath = "Response content path is required";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    try {
      if (editingProvider) {
        // Update existing provider
        const success = updateCustomAiProvider(editingProvider, {
          curl: formData.curl,
          streaming: formData.streaming,
          responseContentPath: formData.responseContentPath,
        });

        if (success) {
          setEditingProvider(null);
          setShowForm(false);
          setFormData({
            id: "",
            streaming: false,
            responseContentPath: "",
            isCustom: true,
            curl: "",
          });
          loadData(); // Refresh data
        } else {
          // Surface the failure. This branch used to be empty, so a failed
          // save left the form open looking exactly like a successful one.
          setErrors({ general: "Failed to update provider. Please try again." });
        }
      } else {
        // Create new provider
        const newProvider = {
          curl: formData.curl,
          streaming: formData.streaming,
          responseContentPath: formData.responseContentPath,
        };

        const saved = addCustomAiProvider(newProvider);
        if (saved) {
          setShowForm(false);
          setFormData({
            id: "",
            streaming: false,
            responseContentPath: "",
            isCustom: true,
            curl: "",
          });
          loadData(); // Refresh data
        } else {
          setErrors({ general: "Failed to save provider. Please try again." });
        }
      }
    } catch (error) {
      console.error("Error saving custom provider:", error);
      setErrors({ general: "Failed to save provider. Please try again." });
    }
  };

  return {
    errors,
    setErrors,
    showForm,
    setShowForm,
    editingProvider,
    setEditingProvider,
    deleteConfirm,
    formData,
    setFormData,
    handleSave,
    handleAutoFill,
    handleEdit,
    handleDelete,
    confirmDelete,
    cancelDelete,
  };
}
