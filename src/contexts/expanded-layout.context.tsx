import { createContext, useContext, useState, ReactNode } from "react";

interface ExpandedLayoutContextType {
  isExpanded: boolean;
  setIsExpanded: (v: boolean) => void;
}

const ExpandedLayoutContext = createContext<ExpandedLayoutContextType>({
  isExpanded: false,
  setIsExpanded: () => {},
});

export const ExpandedLayoutProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <ExpandedLayoutContext.Provider value={{ isExpanded, setIsExpanded }}>
      {children}
    </ExpandedLayoutContext.Provider>
  );
};

export const useExpandedLayout = () => useContext(ExpandedLayoutContext);
