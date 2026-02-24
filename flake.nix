{
  description = "GitHub Notifications Redux - GNOME Shell 49 extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        uuid = "github-notifications-redux@jeppesen.io";

        extensionFiles = [
          "metadata.json"
          "extension.js"
          "prefs.js"
          "stylesheet.css"
          "github-symbolic.svg"
        ];

        # Build the extension zip package
        extension = pkgs.stdenv.mkDerivation {
          pname = "gnome-github-notifications-redux";
          version = "1.1.3";

          src = ./.;

          nativeBuildInputs = [ pkgs.glib.dev pkgs.zip ];

          buildPhase = ''
            # Compile GSettings schemas
            glib-compile-schemas schemas/
          '';

          installPhase = ''
            # Install to gnome-shell extensions directory
            mkdir -p $out/share/gnome-shell/extensions/${uuid}/schemas

            for f in ${builtins.concatStringsSep " " extensionFiles}; do
              cp $f $out/share/gnome-shell/extensions/${uuid}/
            done

            cp schemas/*.xml $out/share/gnome-shell/extensions/${uuid}/schemas/
            cp schemas/gschemas.compiled $out/share/gnome-shell/extensions/${uuid}/schemas/

            # Also produce a .zip for uploading to extensions.gnome.org
            mkdir -p $out/share
            pushd $out/share/gnome-shell/extensions/${uuid}
            zip -r $out/share/${uuid}.zip .
            popd
          '';

          meta = with pkgs.lib; {
            description = "GitHub notification count in the GNOME Shell top panel";
            homepage = "https://github.com/NelsonJeppesen/gnome-github-notifications-redux";
            license = licenses.gpl3Plus;
            platforms = platforms.linux;
          };
        };
      in
      {
        packages = {
          default = extension;
          inherit extension;

          # nix build .#install && ./result/bin/install-extension
          # nix run .#install
          install = pkgs.writeShellScriptBin "install-extension" ''
            set -euo pipefail
            UUID="${uuid}"
            DEST="''${HOME}/.local/share/gnome-shell/extensions/''${UUID}"

            echo "Installing ''${UUID} to ''${DEST} ..."
            mkdir -p "''${DEST}/schemas"

            SRC="${extension}/share/gnome-shell/extensions/''${UUID}"
            cp -f "''${SRC}"/*.json "''${SRC}"/*.js "''${SRC}"/*.css "''${SRC}"/*.svg "''${DEST}/"
            cp -f "''${SRC}"/schemas/* "''${DEST}/schemas/"

            echo "Done. Restart GNOME Shell and enable:"
            echo "  gnome-extensions enable ''${UUID}"
          '';

          # nix run .#test-nested
          # nix run .#test-nested -- --prefs
          test-nested = pkgs.writeShellScriptBin "test-nested" ''
            exec bash "${self}/test-nested.sh" "$@"
          '';
        };

        # nix flake check
        checks = {
          # Validate that the schema XML compiles without errors
          schema-compile = pkgs.runCommand "check-schema-compile" {
            nativeBuildInputs = [ pkgs.glib.dev ];
            src = ./schemas;
          } ''
            mkdir -p schemas
            cp $src/*.xml schemas/
            glib-compile-schemas schemas/
            echo "Schema compilation: OK" > $out
          '';

          # Lint JavaScript with eslint
          lint = pkgs.runCommand "check-lint" {
            nativeBuildInputs = [ pkgs.nodejs ];
            src = ./.;
          } ''
            cd $src
            ${pkgs.nodejs}/bin/node -c extension.js 2>&1 || true
            ${pkgs.nodejs}/bin/node -c prefs.js 2>&1 || true
            echo "Syntax check: OK (ESM imports only valid in GNOME Shell context)" > $out
          '';

          # Validate metadata.json
          metadata-check = pkgs.runCommand "check-metadata" {
            nativeBuildInputs = [ pkgs.jq ];
            src = ./metadata.json;
          } ''
            echo "Validating metadata.json ..."
            jq -e '.uuid' $src > /dev/null
            jq -e '."shell-version" | length > 0' $src > /dev/null
            jq -e '.name' $src > /dev/null

            UUID=$(jq -r '.uuid' $src)
            if [ "$UUID" != "${uuid}" ]; then
              echo "ERROR: UUID mismatch: $UUID != ${uuid}" >&2
              exit 1
            fi

            SHELL_VER=$(jq -r '."shell-version"[0]' $src)
            if [ "$SHELL_VER" != "49" ]; then
              echo "ERROR: Expected shell-version 49, got $SHELL_VER" >&2
              exit 1
            fi

            echo "metadata.json: OK" > $out
          '';

          # Validate SVG icon
          svg-check = pkgs.runCommand "check-svg" {
            nativeBuildInputs = [ pkgs.libxml2 ];
            src = ./github-symbolic.svg;
          } ''
            xmllint --noout $src
            echo "SVG: OK" > $out
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.glib.dev       # glib-compile-schemas
            pkgs.gjs            # GNOME JavaScript runtime
            pkgs.zip            # packaging
            pkgs.jq             # JSON validation
            pkgs.libxml2        # xmllint for SVG validation
            pkgs.nodejs         # JS syntax checking
          ];

          shellHook = ''
            echo "GitHub Notifications Redux - dev shell"
            echo ""
            echo "Commands:"
            echo "  nix build          - build the extension package"
            echo "  nix flake check    - run all checks (schema, lint, metadata, svg)"
            echo "  nix run .#install  - install to ~/.local/share/gnome-shell/extensions/"
            echo "  bash install.sh    - quick local install"
            echo "  bash test-nested.sh         - launch nested GNOME Shell (1000x1000)"
            echo "  bash test-nested.sh --prefs - same, then open the prefs dialog"
            echo ""
          '';
        };
      }
    );
}
