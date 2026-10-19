const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

export default function ReaderText({text}: {text: string}) {
  return <div className="reader-text">{text.replace(/\r\n?/g, '\n').split(/(^#{1,6}[\t ]+.+$)/m).map((part, index) => {
    const heading = /^(#{1,6})[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/.exec(part);
    if (heading) {
      const Heading = headingTags[heading[1].length - 1];
      return <Heading key={index}>{heading[2]}</Heading>;
    }
    return part.trim() ? <div key={index}>{part.trim()}</div> : null;
  })}</div>;
}
