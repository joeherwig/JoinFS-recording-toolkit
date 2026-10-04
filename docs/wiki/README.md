# Wiki sources

These pages are the wiki of the toolkit. They live in the repository so they are versioned with the code and
reviewed with it. Links use the GitHub wiki style (`[text](Page-Name)`, no extension), so browse them in the wiki,
not in this folder.

## Publish to the GitHub wiki

GitHub keeps a wiki in a separate git repository (`<repo>.wiki.git`) that exists after the first page has been
created in the web interface (Wiki tab, "Create the first page").

```sh
git clone git@github.com:joeherwig/JoinFS-recording-toolkit.wiki.git ../JoinFS-recording-toolkit.wiki
cp docs/wiki/*.md ../JoinFS-recording-toolkit.wiki/      # README.md here is not needed there
rm ../JoinFS-recording-toolkit.wiki/README.md
cd ../JoinFS-recording-toolkit.wiki && git add -A && git commit -m "Update wiki" && git push
```

Page names come from the file names (`Editing-Tracks.md` is "Editing Tracks"); `_Sidebar.md` is the navigation.
